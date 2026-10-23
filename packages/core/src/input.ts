import {readFile, realpath, stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import AjvModule from 'ajv';
import {sourceExcludedPath} from './source-paths.js';
import type {Context, Workspace} from './types.js';

export interface Diagnostic {
  code: string;
  phase: string;
  message: string;
  causes: string[];
  file?: string;
  profileId?: string;
  featureId?: string;
  suggestion?: string;
  range?: {start:{line:number;column:number};end:{line:number;column:number}};
}

export class Failure extends Error {
  exitCode: 2|3|4;
  diagnostic: Diagnostic;
  constructor(exitCode: 2|3|4, diagnostic: Diagnostic) {
    super(diagnostic.message);
    this.exitCode = exitCode;
    this.diagnostic = diagnostic;
  }
}

export function fail(code: string, message: string, exitCode: 2|3|4 = 2, file?: string): never {
  throw new Failure(exitCode, {
    code,
    phase: exitCode === 3 ? 'adapter' : exitCode === 4 ? 'toolchain' : 'configuration',
    message,
    causes: [],
    ...(file ? {file} : {})
  });
}

const Ajv = AjvModule.default;
const ajv = new Ajv({allErrors: true, strict: false});
const validators = new Map<string, ReturnType<typeof ajv.compile>>();

export async function json<T>(file: string, schema: string): Promise<T> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(file, 'utf8'));
  } catch {
    fail('JSON_INVALID', `Cannot read valid JSON: ${file}`, 2, file);
  }
  let validate = validators.get(schema);
  if (!validate) {
    validate = ajv.compile(JSON.parse(await readFile(fileURLToPath(new URL(`../schemas/${schema}.schema.json`, import.meta.url)), 'utf8')));
    validators.set(schema, validate);
  }
  if (!validate(value)) {
    fail('SCHEMA_INVALID', `${schema}: ${ajv.errorsText(validate.errors)}`, 2, file);
  }
  return value as T;
}

export function contained(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate);
  return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel));
}

export function privatePath(file: string): boolean {
  return file.split(/[\\/]/).some(part => /^\.env(?:\.|$)|^conf\.priv(?:\.|$)|^(?:secrets?|credentials?)(?:\.|$)/i.test(part));
}

export async function inside(root: string, relative: string, exists = true): Promise<string> {
  if (path.isAbsolute(relative) || privatePath(relative)) {
    fail('PATH_INVALID', 'Expected a relative non-private path');
  }
  const candidate = path.resolve(root, relative);
  if (!contained(root, candidate)) {
    fail('PATH_ESCAPE', 'Path escapes declared root');
  }
  if (exists) {
    let resolved: string;
    try {
      resolved = await realpath(candidate);
    } catch {
      fail('PATH_MISSING', `Missing declared path: ${relative}`);
    }
    if (!contained(root, resolved) || privatePath(path.relative(root, resolved))) {
      fail('PATH_ESCAPE', 'Real path escapes declared root or targets private input');
    }
    return resolved;
  }
  let current = candidate;
  while (true) {
    try {
      const resolved = await realpath(current);
      if (!contained(root, resolved)) {
        fail('PATH_ESCAPE', 'Output ancestor escapes workspace');
      }
      break;
    } catch (error) {
      if (error instanceof Failure) { throw error; }
      const parent = path.dirname(current);
      if (parent === current) {
        fail('PATH_MISSING', 'No output ancestor');
      }
      current = parent;
    }
  }
  return candidate;
}

export async function sourceInput(root: string, relative: string): Promise<string> {
  if (sourceExcludedPath(relative)) {
    fail('SOURCE_INPUT_EXCLUDED', 'Declared input is excluded from the source digest');
  }
  const resolved = await inside(root, relative);
  if (sourceExcludedPath(path.relative(root, resolved))) {
    fail('SOURCE_INPUT_EXCLUDED', 'Resolved input is excluded from the source digest');
  }
  return resolved;
}

export async function workspace(file: string): Promise<Context> {
  let resolved: string;
  try {
    resolved = await realpath(path.resolve(file));
  } catch {
    fail('WORKSPACE_MISSING', 'Workspace file does not exist');
  }
  const root = path.dirname(resolved);
  const value = await json<Workspace>(resolved, 'workspace');

  async function sourceRoot(relative: string): Promise<string> {
    if (privatePath(relative)) { fail('PATH_INVALID', 'Source path targets private input'); }
    let candidate = path.resolve(root, relative);
    let resolvedRoot: string;
    try {
      resolvedRoot = await realpath(candidate);
    } catch {
      try {
        const nmCandidate = path.resolve(root, 'node_modules', relative);
        resolvedRoot = await realpath(nmCandidate);
      } catch {
        fail('PATH_MISSING', 'Declared source root does not exist');
      }
    }
    if (privatePath(resolvedRoot)) { fail('PATH_INVALID', 'Resolved source root targets private input'); }
    if (contained(resolvedRoot, root)) { fail('SOURCE_ROOT_OVERLAP', 'Source root cannot equal or contain the workspace root'); }

    // If dist/selective.json exists (e.g. built npm package) and selective.json is not at the package root, resolve to dist
    try {
      const direct = await stat(path.join(resolvedRoot, 'selective.json'));
      if (!direct.isFile()) throw new Error();
    } catch {
      try {
        const dist = await stat(path.join(resolvedRoot, 'dist', 'selective.json'));
        if (dist.isFile()) {
          resolvedRoot = path.join(resolvedRoot, 'dist');
        }
      } catch {}
    }

    return resolvedRoot;
  }

  let upstream = '';
  let extensions: string[] = [];

  if (value.schemaVersion === 1) {
    upstream = await sourceRoot(value.upstream.path);
    extensions = await Promise.all(value.extensions.map(sourceRoot));
    if (new Set([upstream, ...extensions]).size !== extensions.length + 1) {
      fail('SOURCE_DUPLICATE', 'Source roots must be unique');
    }
  } else {
    extensions = await Promise.all(value.libraries.map(sourceRoot));
    const b0oIdx = extensions.findIndex(lib => lib.endsWith('lib-b0o') || lib.includes('b0o') || lib.endsWith('upstream'));
    upstream = b0oIdx >= 0 ? extensions[b0oIdx] : '';
    if (new Set(extensions).size !== extensions.length) {
      fail('SOURCE_DUPLICATE', 'Source roots must be unique');
    }
  }

  const profilesDir = await inside(root, value.profilesDir);
  const outDir = await inside(root, value.outDir, false);

  const allDirs = [profilesDir, ...extensions];
  if (upstream && !extensions.includes(upstream)) allDirs.push(upstream);
  for (const dir of allDirs) {
    if (!(await stat(dir)).isDirectory()) { fail('PATH_INVALID', 'Declared directory must be a directory'); }
  }

  return { workspace: value, file: resolved, root, upstream, extensions, profilesDir, outDir };
}
