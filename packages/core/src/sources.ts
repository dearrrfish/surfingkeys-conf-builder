import {createHash, randomUUID} from 'node:crypto';
import {readFile, readdir, lstat, realpath, open, rename, unlink} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {git, head, loadCatalog} from './catalog.js';
import {fail, Failure, json, contained, privatePath, sourceInput} from './input.js';
import type {Context, Source, SourcesLock, Manifest} from './types.js';
import {sourceExcludedPath} from './source-paths.js';

export const digestRule = 'sha256-path-content-v1-private-excluded';

async function gitInfo(root: string, required: boolean): Promise<{sha?: string; files?: string[]}> {
  try {
    const top = (await git('git', ['-C', root, 'rev-parse', '--show-toplevel'])).stdout.trim();
    if (await realpath(top) !== root) {
      if (required) { fail('SOURCE_GIT_REQUIRED', 'Source must be a Git root', 3); }
      return {};
    }
    const dirty = (await git('git', ['-C', root, 'status', '--porcelain', '--untracked-files=all'])).stdout;
    if (dirty.trim()) { fail('SOURCE_DIRTY', 'Declared Git source has local changes'); }
    const files = (await git('git', ['-C', root, 'ls-files', '-z'])).stdout.split('\0').filter(Boolean);
    return {sha: await head(root), files};
  } catch (error) {
    if (error instanceof Failure) { throw error; }
    if (required) { fail('SOURCE_GIT_REQUIRED', 'Upstream must be a Git root', 3); }
    return {};
  }
}

export async function digestDirectory(root: string, tracked?: string[]): Promise<string> {
  const files: string[] = [];
  async function walk(relative: string): Promise<void> {
    for (const name of (await readdir(path.join(root, relative))).sort()) {
      if (sourceExcludedPath(name) || privatePath(name)) { continue; }
      const rel = path.join(relative, name);
      const file = path.join(root, rel);
      const info = await lstat(file);
      if (info.isSymbolicLink()) {
        const target = await realpath(file);
        if (sourceExcludedPath(path.relative(root, target))) { fail('SOURCE_INPUT_EXCLUDED', 'Source symlink targets excluded digest input'); }
        if (!contained(root, target) || privatePath(path.relative(root, target))) { fail('PATH_ESCAPE', 'Source symlink escapes root or targets private input'); }
        if ((await lstat(target)).isDirectory()) { fail('SOURCE_SYMLINK_DIRECTORY', 'Source directory symlinks are unsupported'); }
        files.push(rel);
      } else if (info.isDirectory()) {
        await walk(rel);
      } else if (info.isFile()) {
        files.push(rel);
      }
    }
  }
  if (tracked) {
    for (const rel of tracked) {
      if (sourceExcludedPath(rel) || privatePath(rel)) { continue; }
      const file = path.join(root, rel);
      const resolved = await realpath(file);
      if (sourceExcludedPath(path.relative(root, resolved))) { fail('SOURCE_INPUT_EXCLUDED', 'Tracked source targets excluded digest input'); }
      if (!contained(root, resolved) || privatePath(path.relative(root, resolved))) { fail('PATH_ESCAPE', 'Tracked source escapes root'); }
      if ((await lstat(resolved)).isFile()) { files.push(rel); }
    }
  } else {
    await walk('');
  }
  const hash = createHash('sha256');
  for (const relative of files.sort()) {
    const bytes = await readFile(path.join(root, relative));
    const name = relative.split(path.sep).join('/');
    hash.update(`${Buffer.byteLength(name)}:${name}:${bytes.length}:`);
    hash.update(bytes);
  }
  return hash.digest('hex');
}

export async function computeToolchainHash(): Promise<string> {
  const candidates = [
    new URL('../package-lock.json', import.meta.url),
    new URL('../../package-lock.json', import.meta.url),
    new URL('../pnpm-lock.yaml', import.meta.url),
    new URL('../../pnpm-lock.yaml', import.meta.url),
    new URL('../package.json', import.meta.url)
  ];
  for (const candidate of candidates) {
    try {
      const bytes = await readFile(fileURLToPath(candidate));
      return createHash('sha256').update(bytes).digest('hex');
    } catch {}
  }
  return createHash('sha256').update('skcb-core-v2').digest('hex');
}

export async function snapshot(ctx: Context): Promise<SourcesLock> {
  await loadCatalog(ctx);
  async function source(root: string, required: boolean): Promise<Source> {
    const info = await gitInfo(root, required);
    return {
      root: path.relative(ctx.root, root).split(path.sep).join('/'),
      contentHash: await digestDirectory(root, required ? info.files : undefined),
      ...(info.sha ? {sha: info.sha} : {})
    };
  }

  const toolchainHash = await computeToolchainHash();

  if (ctx.workspace.schemaVersion === 2) {
    const libraries: Source[] = [];
    if (ctx.upstream) {
      const b0oSource = await source(ctx.upstream, false);
      libraries.push({...b0oSource, id: '@skcb/lib-b0o', namespace: 'b0o'});
    }
    for (const root of ctx.extensions) {
      const manifest = await json<Manifest>(await sourceInput(root, 'selective.json'), 'manifest');
      libraries.push({...await source(root, false), id: manifest.namespace, namespace: manifest.namespace});
    }
    return {
      schemaVersion: 2,
      digestRule,
      libraries,
      toolchainHash
    };
  }

  // schemaVersion: 1
  const upstream = await source(ctx.upstream, true);
  const extensions: Source[] = [];
  for (const root of ctx.extensions) {
    const manifest = await json<Manifest>(await sourceInput(root, 'selective.json'), 'manifest');
    extensions.push({...await source(root, false), namespace: manifest.namespace});
  }
  return {
    schemaVersion: 1,
    digestRule,
    adapterVersion: 'b0o-v1-static-1',
    upstream,
    extensions,
    toolchainHash
  };
}

async function safeLockTarget(file: string): Promise<void> {
  try {
    const info = await lstat(file);
    if (info.isSymbolicLink() || !info.isFile()) {
      fail('LOCK_PATH_INVALID', 'Lock target must be a regular file', 4);
    }
  } catch (error) {
    if (error instanceof Failure) { throw error; }
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { throw error; }
  }
}

export interface SourceHandshakeHooks {
  beforeReaderMarker?: () => Promise<void>;
  afterReaderMarker?: () => Promise<void>;
  afterWriterMarker?: () => Promise<void>;
}

export async function refresh(ctx: Context, hook?: () => Promise<void>, handshake?: SourceHandshakeHooks): Promise<SourcesLock> {
  const marker = path.join(ctx.root, '.sources.lock.busy');
  const target = path.join(ctx.root, 'sources.lock.json');
  const temporary = path.join(ctx.root, `.sources.lock.${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await open(marker, 'wx', 0o600);
  } catch {
    fail('SOURCE_LOCK_BUSY', 'Workspace source lock is held or marker is unsafe', 4);
  }
  try {
    await handshake?.afterWriterMarker?.();
    if ((await readdir(ctx.root)).some(name => name.startsWith('.sources.reader.'))) {
      fail('SOURCE_LOCK_BUSY', 'Active builds hold source read leases', 4);
    }
    await safeLockTarget(target);
    const result = await snapshot(ctx);
    await hook?.();
    const rechecked = await snapshot(ctx);
    if (JSON.stringify(result) !== JSON.stringify(rechecked)) {
      fail('SOURCE_CHANGED', 'Sources changed during lock refresh');
    }
    const output = await open(temporary, 'wx', 0o600);
    try {
      await output.writeFile(`${JSON.stringify(result, null, 2)}\n`);
      await output.sync();
    } finally {
      await output.close();
    }
    await safeLockTarget(target);
    await rename(temporary, target);
    return result;
  } finally {
    await handle.close();
    await unlink(temporary).catch(() => {});
    await unlink(marker);
  }
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export async function verifySources(ctx: Context, autoLock = false): Promise<SourcesLock> {
  try {
    await lstat(path.join(ctx.root, '.sources.lock.busy'));
    fail('SOURCE_LOCK_BUSY', 'Workspace source refresh is in progress', 4);
  } catch (error) {
    if (error instanceof Failure) { throw error; }
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { throw error; }
  }
  const target = path.join(ctx.root, 'sources.lock.json');
  await safeLockTarget(target);
  let lock: SourcesLock;
  try {
    lock = await json<SourcesLock>(target, 'lock');
  } catch (error) {
    if (error instanceof Failure && error.diagnostic.code === 'JSON_INVALID') {
      if (autoLock) {
        return refresh(ctx);
      }
      fail('SOURCE_LOCK_REQUIRED', 'Run sources lock --refresh before validate/explain');
    }
    throw error;
  }
  const actual = await snapshot(ctx);
  if (canonical(lock) !== canonical(actual)) {
    if (autoLock) {
      return refresh(ctx);
    }
    fail('SOURCE_LOCK_MISMATCH', 'Source metadata or content differs from sources.lock.json');
  }
  return lock;
}

export async function readLease(ctx: Context, hooks?: SourceHandshakeHooks): Promise<() => Promise<void>> {
  const marker = path.join(ctx.root, `.sources.reader.${randomUUID()}`);
  await verifySources(ctx);
  await hooks?.beforeReaderMarker?.();
  const handle = await open(marker, 'wx', 0o600);
  await handle.close();
  try {
    await hooks?.afterReaderMarker?.();
    await verifySources(ctx);
  } catch (error) {
    await unlink(marker);
    throw error;
  }
  return () => unlink(marker);
}
