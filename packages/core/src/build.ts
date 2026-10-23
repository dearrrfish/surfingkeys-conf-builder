import {createHash, randomUUID} from 'node:crypto';
import {readFile, readdir, mkdir, lstat, open, rename, unlink, rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {workspace, inside, fail, Failure, json, sourceInput} from './input.js';
import {loadCatalog} from './catalog.js';
import {registrationPlan} from './registration.js';
import {resolveProfile, explain} from './profiles.js';
import {analyzeCode} from './code-analysis.js';
import {verifySources, readLease} from './sources.js';
import {generateGraph} from './generation.js';
import {bundle} from './bundler.js';
import type {Context, Profile} from './types.js';

export interface BuildRequest {
  workspacePath: string;
  profileId: string;
  mode?: 'production' | 'development';
  autoLock?: boolean;
}

export interface BuildHooks {
  afterCapture?: () => Promise<void>;
  beforeBundle?: () => Promise<void>;
  beforePublish?: () => Promise<void>;
  beforePointer?: () => Promise<void>;
}

export interface BuildResult {
  ok: true;
  profileId: string;
  buildId: string;
  directory: string;
  current: string;
  report: BuildReport;
  scriptPath: string;
  reportPath: string;
  inputHash: string;
  outputHash: string;
}

export interface BuildReport {
  schemaVersion: 1 | 2;
  profileId: string;
  buildId: string;
  inputHash: string;
  input: unknown;
  analysis: any;
  generatedFiles: string[];
  packages: {name: string; version: string; license: string}[];
  outputs: {script: {sha256: string; bytes: number}; notices: {sha256: string; bytes: number}};
}

export const canonical = (v: unknown): string =>
  Array.isArray(v)
    ? `[${v.map(canonical).join(',')}]`
    : v && typeof v === 'object'
    ? `{${Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, value]) => `${JSON.stringify(k)}:${canonical(value)}`).join(',')}}`
    : JSON.stringify(v);

export const hash = (v: string | Buffer): string => createHash('sha256').update(v).digest('hex');

function analysisHash(result: any, graph: unknown): string {
  return hash(canonical({registrationIR: result.registrationIR, retainedSymbols: graph, reasons: result.reasons, capabilityReasons: result.capabilityReasons}));
}

async function safeDirectory(ctx: Context, relative: string): Promise<string> {
  const dir = await inside(ctx.root, relative, false);
  let current = ctx.root;
  for (const part of path.relative(ctx.root, dir).split(path.sep)) {
    current = path.join(current, part);
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink() || !info.isDirectory()) {
        fail('OUTPUT_PATH_INVALID', 'Output directories must be real directories', 4);
      }
    } catch (error) {
      if (error instanceof Failure) { throw error; }
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { throw error; }
      await mkdir(current);
    }
  }
  return dir;
}

async function existingOutputDirectory(ctx: Context, candidate: string): Promise<string> {
  const relative = path.relative(ctx.root, candidate);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    fail('COMPARE_REPORT_INVALID', 'Build path escapes workspace');
  }
  let current = ctx.root;
  for (const part of relative.split(path.sep)) {
    current = path.join(current, part);
    const info = await lstat(current);
    if (info.isSymbolicLink() || !info.isDirectory()) {
      fail('COMPARE_REPORT_INVALID', 'Every build ancestor must be a real directory');
    }
  }
  return current;
}

async function regular(file: string): Promise<Buffer> {
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink()) {
    fail('BUILD_ARTIFACT_INVALID', 'Expected regular build artifact', 4);
  }
  return readFile(file);
}

async function implementationHash(): Promise<string> {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const items: string[] = [];
  for (const dir of ['src', 'schemas']) {
    try {
      for (const name of (await readdir(path.join(root, dir))).sort()) {
        if (name.endsWith('.ts') || name.endsWith('.json')) {
          items.push(`${dir}/${name}\0${await readFile(path.join(root, dir, name), 'utf8')}\0`);
        }
      }
    } catch {}
  }
  return hash(items.join(''));
}

export async function analyzeConfiguration(file: string, id: string): Promise<any> {
  const ctx = await workspace(file);
  const catalog = await loadCatalog(ctx);
  await verifySources(ctx);
  const profile = await resolveProfile(ctx, id, catalog);
  const result = explain(profile, catalog) as any;
  const graph = await analyzeCode(ctx, catalog, profile, result);
  await verifySources(ctx);
  return {
    ...result,
    validationLevel: 'sourceAnalysis',
    codeAnalysis: 'complete',
    registrationConflictChecks: 'complete',
    buildReady: true,
    buildReadiness: 'static analysis only; browser and factory execution not verified',
    retainedSymbols: graph,
    pending: []
  };
}

async function verifyBuild(dir: string, id: string): Promise<BuildReport> {
  await regular(path.join(dir, 'report.json'));
  const report = await json<BuildReport>(path.join(dir, 'report.json'), 'report');
  if (report.buildId !== id || hash(canonical(report.input)) !== id || report.inputHash !== id) {
    fail('BUILD_ARTIFACT_INVALID', 'Build identity mismatch', 4);
  }
  const input = report.input as any;
  const analysis = report.analysis;
  if (
    report.profileId !== input.profile.id ||
    canonical(analysis.profile) !== canonical(input.profile) ||
    canonical(analysis.requested) !== canonical(input.profile.select) ||
    canonical(analysis.resolvedFeatures) !== canonical(input.selection.features) ||
    canonical(analysis.contributions) !== canonical(input.selection.contributions) ||
    canonical(analysis.resolvedCapabilities) !== canonical(input.selection.capabilities) ||
    canonical(analysis.suppressedContributions) !== canonical(input.selection.suppressed) ||
    analysisHash(analysis, analysis.retainedSymbols) !== input.analysisHash ||
    canonical(registrationPlan(analysis.contributions, analysis.profile)) !== canonical(analysis.registrationIR)
  ) {
    fail('BUILD_ARTIFACT_INVALID', 'Report analysis differs from identity-backed input', 4);
  }
  const graph = analysis.retainedSymbols;
  const ids = new Set(graph.nodes.map((n: any) => n.id));
  const componentIds = graph.components.flat();
  if (
    ids.size !== graph.nodes.length ||
    componentIds.length !== ids.size ||
    new Set(componentIds).size !== ids.size ||
    componentIds.some((id: string) => !ids.has(id)) ||
    graph.edges.some((e: any) => !ids.has(e.from) || !ids.has(e.to)) ||
    graph.nodes.some((n: any) => n.id !== `${n.file}#${n.symbol}` || n.range.end.line < n.range.start.line || (n.range.end.line === n.range.start.line && n.range.end.column < n.range.start.column))
  ) {
    fail('BUILD_ARTIFACT_INVALID', 'Retained graph is inconsistent', 4);
  }
  for (const [name, expected] of [['surfingkeys.js', report.outputs.script], ['THIRD_PARTY_NOTICES.txt', report.outputs.notices]] as const) {
    const bytes = await regular(path.join(dir, name));
    if (hash(bytes) !== expected.sha256 || bytes.length !== expected.bytes) {
      fail('BUILD_ARTIFACT_INVALID', 'Stored build hash mismatch', 4);
    }
  }
  return report;
}

export async function buildWithSelectives(request: BuildRequest): Promise<BuildResult> {
  return buildInternal(request);
}

export async function buildInternal(request: BuildRequest, hooks?: BuildHooks): Promise<BuildResult> {
  const ctx = await workspace(request.workspacePath);
  const mode = request.mode ?? 'production';
  if (!['production', 'development'].includes(mode)) {
    fail('BUILD_MODE_INVALID', 'Invalid mode');
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(request.profileId)) {
    fail('PROFILE_UNKNOWN', 'Invalid profile id');
  }

  const dir = await safeDirectory(ctx, path.relative(ctx.root, path.join(ctx.outDir, request.profileId)));
  const marker = path.join(dir, '.build.busy');
  let mutex;
  try {
    mutex = await open(marker, 'wx', 0o600);
  } catch {
    fail('BUILD_BUSY', 'Profile build is already held or marker unsafe', 4);
  }

  let release: (() => Promise<void>) | undefined;
  const stage = path.join(dir, `.stage-${randomUUID()}`);
  try {
    release = await readLease(ctx);
    const catalog = await loadCatalog(ctx);
    const profile = await resolveProfile(ctx, request.profileId, catalog);
    if (profile.abstract) {
      fail('PROFILE_ABSTRACT', 'Cannot build abstract profile');
    }
    const result = explain(profile, catalog) as any;
    await verifySources(ctx);
    const capture = new Map<string, string>();
    let upstreamLicense = '';
    if (ctx.upstream) {
      try {
        const lic = await sourceInput(ctx.upstream, 'LICENSE');
        upstreamLicense = await readFile(lic, 'utf8');
        capture.set(lic, upstreamLicense);
      } catch {}
    }
    const graph = await analyzeCode(ctx, catalog, profile, result, capture);
    const lock = await verifySources(ctx);
    await hooks?.afterCapture?.();
    await verifySources(ctx);

    const sources = ('upstream' in lock && lock.upstream)
      ? {
          upstream: { namespace: 'upstream', sha: lock.upstream.sha, contentHash: lock.upstream.contentHash },
          extensions: lock.extensions.map(s => ({ namespace: s.namespace, sha: s.sha ?? null, contentHash: s.contentHash })).sort((a, b) => a.namespace!.localeCompare(b.namespace!))
        }
      : {
          libraries: ((lock as any).libraries || []).map((s: any) => ({ id: s.id, namespace: s.namespace, sha: s.sha ?? null, contentHash: s.contentHash })).sort((a: any, b: any) => (a.id || '').localeCompare(b.id || ''))
        };

    const input = {
      analysisHash: analysisHash(result, graph),
      profile,
      selection: {
        features: result.resolvedFeatures,
        contributions: result.contributions,
        capabilities: result.resolvedCapabilities,
        suppressed: result.suppressedContributions
      },
      sources,
      toolchain: {
        lockHash: lock.toolchainHash,
        implementationHash: await implementationHash(),
        node: process.versions.node
      },
      mode
    };
    const id = hash(canonical(input));

    await mkdir(stage);
    const generated = await generateGraph(ctx, catalog, profile, result, graph, capture, path.join(stage, 'generated'));
    await hooks?.beforeBundle?.();
    const bundled = await bundle(generated.entry, stage, mode, upstreamLicense);
    await writeSynced(path.join(stage, 'THIRD_PARTY_NOTICES.txt'), bundled.notices);
    const script = await readFile(path.join(stage, 'surfingkeys.js'));
    const notices = Buffer.from(bundled.notices);
    const report: BuildReport = {
      schemaVersion: ctx.workspace.schemaVersion === 2 ? 2 : 1,
      profileId: profile.id,
      buildId: id,
      inputHash: id,
      input,
      analysis: {
        ...result,
        profile,
        codeAnalysis: 'complete',
        registrationConflictChecks: 'complete',
        buildReady: true,
        pending: [],
        retainedSymbols: graph
      },
      generatedFiles: generated.files,
      packages: bundled.packages,
      outputs: {
        script: {sha256: hash(script), bytes: script.length},
        notices: {sha256: hash(notices), bytes: notices.length}
      }
    };
    await writeSynced(path.join(stage, 'report.json'), canonical(report) + '\n');
    await verifyBuild(stage, id);
    await hooks?.beforePublish?.();
    await verifySources(ctx);

    const builds = await safeDirectory(ctx, path.relative(ctx.root, path.join(dir, 'builds')));
    const destination = path.join(builds, id);
    try {
      const existing = await lstat(destination);
      if (existing.isSymbolicLink() || !existing.isDirectory()) {
        fail('BUILD_ARTIFACT_INVALID', 'Immutable build directory must be real', 4);
      }
      const stored = await verifyBuild(destination, id);
      if (canonical(stored) !== canonical(report)) {
        fail('BUILD_ARTIFACT_INVALID', 'Existing immutable build differs', 4);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        await rename(stage, destination);
      } else {
        throw error;
      }
    }

    const pointer = path.join(dir, 'current.json');
    try {
      const info = await lstat(pointer);
      if (info.isSymbolicLink() || !info.isFile()) {
        fail('CURRENT_PATH_INVALID', 'Current pointer must be regular', 4);
      }
    } catch (error) {
      if (error instanceof Failure) { throw error; }
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { throw error; }
    }

    await hooks?.beforePointer?.();
    await verifySources(ctx);
    const temporary = path.join(dir, `.current-${randomUUID()}.tmp`);
    try {
      await writeSynced(
        temporary,
        canonical({
          schemaVersion: 1,
          profileId: profile.id,
          buildId: id,
          outputHash: report.outputs.script.sha256,
          noticesHash: report.outputs.notices.sha256,
          artifacts: {
            script: `builds/${id}/surfingkeys.js`,
            report: `builds/${id}/report.json`,
            notices: `builds/${id}/THIRD_PARTY_NOTICES.txt`
          },
          reportHash: hash(canonical(report) + '\n')
        }) + '\n'
      );
      await rename(temporary, pointer);
    } finally {
      await unlink(temporary).catch(() => {});
    }

    return {
      ok: true,
      profileId: profile.id,
      buildId: id,
      directory: destination,
      current: pointer,
      report,
      scriptPath: path.join(destination, 'surfingkeys.js'),
      reportPath: path.join(destination, 'report.json'),
      inputHash: id,
      outputHash: report.outputs.script.sha256
    };
  } finally {
    await rm(stage, {recursive: true, force: true});
    await release?.();
    await mutex.close();
    await unlink(marker);
  }
}

async function writeSynced(file: string, text: string): Promise<void> {
  const handle = await open(file, 'wx', 0o600);
  try {
    await handle.writeFile(text);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function profileIds(file: string): Promise<string[]> {
  const ctx = await workspace(file);
  const ids: string[] = [];
  async function scan(dir: string): Promise<void> {
    for (const item of await readdir(dir, {withFileTypes: true})) {
      const f = await inside(ctx.profilesDir, path.relative(ctx.profilesDir, path.join(dir, item.name)));
      if (item.isDirectory()) {
        await scan(f);
      } else if (item.name.endsWith('.json')) {
        const profile = await json<Profile>(f, 'profile');
        if (!profile.abstract) {
          ids.push(profile.id);
        }
      }
    }
  }
  await scan(ctx.profilesDir);
  return ids.sort();
}

export async function compare(file: string, id: string, against: string): Promise<unknown> {
  if (!/^[a-f0-9]{64}$/.test(against)) {
    fail('COMPARE_ID_INVALID', 'Expected canonical SHA256 buildId');
  }
  const ctx = await workspace(file);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
    fail('COMPARE_PROFILE_INVALID', 'Invalid profile id');
  }
  const candidate = path.join(ctx.outDir, id, 'builds', against);
  let previous: BuildReport;
  try {
    const directory = await existingOutputDirectory(ctx, candidate);
    previous = await verifyBuild(directory, against);
  } catch (error) {
    fail('COMPARE_REPORT_INVALID', error instanceof Error ? error.message : 'Invalid old build report');
  }
  if (previous.profileId !== id) {
    fail('COMPARE_PROFILE_MISMATCH', 'Report belongs to another profile');
  }
  const current = await analyzeConfiguration(file, id);
  const before = previous.analysis;
  const changes = Object.fromEntries(
    ['contributions', 'resolvedFeatures', 'resolvedCapabilities', 'retainedSymbols', 'profile', 'registrationIR'].map(key => [
      key,
      {changed: canonical(before[key]) !== canonical(current[key]), before: before[key], after: current[key]}
    ])
  );
  return {
    ok: true,
    profileId: id,
    against,
    changes,
    packages: {
      previousActual: previous.packages,
      currentStaticDependencies: current.retainedSymbols.externalDependencies,
      comparable: false
    }
  };
}
