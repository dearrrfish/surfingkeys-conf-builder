import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fixture } from './helpers.ts';
import {
  validateProfiles,
  main
} from '../templates/skcb-proj-repo/scripts/validate-profiles.mjs';

const exec = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

test('pages-workflow: pages.yml has required triggers, permissions, concurrency, and environment', async () => {
  const workflowPath = path.resolve(projectRoot, 'templates/skcb-proj-repo/.github/workflows/pages.yml');
  const content = await readFile(workflowPath, 'utf8');

  // Trigger assertions
  assert.ok(content.includes('pull_request:'), 'must have pull_request trigger');
  assert.ok(content.includes('push:'), 'must have push trigger');
  assert.ok(content.includes('workflow_dispatch:'), 'must have workflow_dispatch trigger');
  assert.ok(content.includes("- 'profiles/**'"), 'must filter on profiles/**');
  assert.ok(content.includes("- 'extensions/**'"), 'must filter on extensions/**');
  assert.ok(content.includes("- 'surfingkeys.workspace.json'"), 'must filter on surfingkeys.workspace.json');
  assert.ok(content.includes("- 'scripts/**'"), 'must filter on scripts/**');
  assert.ok(content.includes("- '.github/workflows/pages.yml'"), 'must filter on workflow itself');

  // Security & permissions assertions
  assert.ok(content.includes('contents: read'), 'must include contents: read');
  assert.ok(content.includes('pages: write'), 'must include pages: write');
  assert.ok(content.includes('id-token: write'), 'must include id-token: write');
  assert.ok(!content.includes('contents: write'), 'strictly NO contents: write');
  assert.ok(!content.includes('pull-requests: write'), 'strictly NO pull-requests: write');

  // Concurrency assertions
  assert.ok(content.includes('group: pages-${{ github.ref }}'), 'concurrency group must be pages-${{ github.ref }}');
  assert.ok(content.includes('cancel-in-progress: false'), 'cancel-in-progress must be false');

  // Default disabled assertions
  assert.ok(content.includes("ENABLED: 'false'"), 'ENABLED env must default to false');
  assert.ok(
    content.includes("vars.PAGES_DEPLOY_ENABLED == 'true'"),
    'deploy job condition must check vars.PAGES_DEPLOY_ENABLED'
  );
  assert.ok(
    content.includes("github.event_name != 'pull_request'"),
    'deploy job condition must exclude pull_request events'
  );

  // Job separation: validate vs deploy
  assert.ok(content.includes('validate:'), 'must contain validate job');
  assert.ok(content.includes("if: ${{ github.event_name == 'pull_request' }}"), 'validate job must run on PR');
  assert.ok(content.includes('deploy:'), 'must contain deploy job');
  assert.ok(content.includes('environment:'), 'deploy job must specify environment');
  assert.ok(content.includes('name: github-pages'), 'environment name must be github-pages');

  // Toolchain & step assertions
  assert.ok(content.includes('version: 10.11.0'), 'explicit pnpm version 10.11.0 required');
  assert.ok(content.includes('node-version: 24'), 'Node 24 required');
  assert.ok(content.includes('npm run validate:profiles'), 'must run profile validation');
  assert.ok(content.includes('npm run pages:build'), 'must run pages:build');
  assert.ok(content.includes('actions/configure-pages@v5'), 'must use configure-pages@v5');
  assert.ok(content.includes('actions/upload-pages-artifact@v3'), 'must use upload-pages-artifact@v3');
  assert.ok(content.includes('path: .pages'), 'artifact path must be .pages');
  assert.ok(content.includes('actions/deploy-pages@v4'), 'must use deploy-pages@v4');

  // Must NOT build full bundle
  assert.ok(!content.includes('npm run build'), 'must not run npm run build');
});

test('pages-template: package.json, .gitignore, and README.md reflect static pages requirements', async () => {
  const pkgPath = path.resolve(projectRoot, 'templates/skcb-proj-repo/package.json');
  const pkg = JSON.parse(await readFile(pkgPath, 'utf8'));

  assert.equal(pkg.dependencies['@skcb/ui'], '^0.3.0', '@skcb/ui dependency must be ^0.3.0');
  assert.equal(pkg.scripts['pages:build'], 'skcb-ui --export-static --out .pages', 'pages:build script mismatch');
  assert.equal(pkg.scripts['validate:profiles'], 'node scripts/validate-profiles.mjs', 'validate:profiles script mismatch');

  const gitignorePath = path.resolve(projectRoot, 'templates/skcb-proj-repo/.gitignore');
  const gitignoreContent = await readFile(gitignorePath, 'utf8');
  assert.ok(gitignoreContent.includes('.pages/'), '.gitignore must ignore .pages/');

  const readmePath = path.resolve(projectRoot, 'templates/skcb-proj-repo/README.md');
  const readmeContent = await readFile(readmePath, 'utf8');
  assert.ok(readmeContent.includes('PAGES_DEPLOY_ENABLED'), 'README must mention PAGES_DEPLOY_ENABLED');
  assert.ok(readmeContent.includes('Contents: Read and write'), 'README must document PAT contents permission');
  assert.ok(readmeContent.includes('Pull requests: Read and write'), 'README must document PAT pull requests permission');
  assert.ok(readmeContent.includes('PAT 直连模式'), 'README must document PAT mode');
  assert.ok(readmeContent.includes('GitHub 网页模式'), 'README must document Web mode');
  assert.ok(readmeContent.includes('localStorage'), 'README must document localStorage risk');
  assert.ok(!readmeContent.includes('skcb export-pages'), 'README must not reference nonexistent skcb export-pages');
});

test('pages-validation: validateProfiles handles valid workspaces and profiles', async (t) => {
  const f = await fixture(false);
  t.after(f.cleanup);

  // 1. Validate by directory path
  const dirResult = await validateProfiles({ workspacePath: f.root });
  assert.equal(dirResult.ok, true, `Expected validation to pass, got: ${JSON.stringify(dirResult.diagnostics)}`);
  assert.deepEqual(dirResult.profiles, ['personal', 'work']);
  assert.equal(dirResult.diagnostics.length, 0);

  // 2. Validate by workspace file path
  const fileResult = await validateProfiles({
    workspacePath: path.join(f.root, 'surfingkeys.workspace.json')
  });
  assert.equal(fileResult.ok, true);
  assert.deepEqual(fileResult.profiles, ['personal', 'work']);

  // 3. CLI main() returns 0 on valid workspace
  const exitCode = await main(['--workspace', f.root, '--json']);
  assert.equal(exitCode, 0);

  // 4. Direct CLI execution via node process returns exit code 0
  const scriptPath = path.resolve(projectRoot, 'templates/skcb-proj-repo/scripts/validate-profiles.mjs');
  const cliRes = await exec('node', [scriptPath, '--workspace', f.root]);
  assert.ok(cliRes.stdout.includes('validated successfully'));
});

test('pages-validation: validateProfiles catches unknown features and returns diagnostics', async (t) => {
  const f = await fixture(false);
  t.after(f.cleanup);

  // Add broken profile selecting a nonexistent feature
  await f.write('profiles/broken.json', {
    schemaVersion: 1,
    id: 'broken',
    abstract: false,
    selectAdd: ['notes/actions.nonexistent']
  });

  const result = await validateProfiles({ workspacePath: f.root });
  assert.equal(result.ok, false);
  assert.ok(result.diagnostics.length >= 1);
  const diag = result.diagnostics.find(d => d.profileId === 'broken');
  assert.ok(diag, 'Diagnostic should identify the broken profile');
  assert.equal(diag.code, 'FEATURE_UNKNOWN');

  // CLI main() returns 1 on invalid workspace
  const exitCode = await main(['--workspace', f.root]);
  assert.equal(exitCode, 1);

  // Direct CLI execution via node process exits with code 1
  const scriptPath = path.resolve(projectRoot, 'templates/skcb-proj-repo/scripts/validate-profiles.mjs');
  await assert.rejects(
    async () => exec('node', [scriptPath, '--workspace', f.root]),
    (err: any) => err.code === 1 && err.stderr.includes('FEATURE_UNKNOWN')
  );
});

test('pages-validation: validateProfiles catches registration conflicts in strict mode', async (t) => {
  const f = await fixture(false);
  t.after(f.cleanup);

  // Create two conflicting action contributions with same domain and key 'h'
  await f.write('extension/selective.json', {
    schemaVersion: 1,
    namespace: 'notes',
    entries: {
      'actions.notes1': {
        entry: 'entry.js',
        contributions: [{ id: 'home1', kind: 'mapkey', alias: 'h', domain: 'notes.example.com' }]
      },
      'actions.notes2': {
        entry: 'entry.js',
        contributions: [{ id: 'home2', kind: 'mapkey', alias: 'h', domain: 'notes.example.com' }]
      }
    }
  });

  await f.write('profiles/conflict.json', {
    schemaVersion: 1,
    id: 'conflict',
    abstract: false,
    selectAdd: ['notes/actions.notes1', 'notes/actions.notes2']
  });

  const result = await validateProfiles({ workspacePath: f.root });
  assert.equal(result.ok, false);
  const diag = result.diagnostics.find(d => d.profileId === 'conflict');
  assert.ok(diag, 'Diagnostic should identify the conflicting profile');
  assert.equal(diag.code, 'REGISTRATION_CONFLICT');
});

test('pages-validation: validateProfiles handles missing workspace and CLI help flag', async () => {
  // 1. Missing workspace
  const missingResult = await validateProfiles({ workspacePath: 'nonexistent/path/surfingkeys.workspace.json' });
  assert.equal(missingResult.ok, false);
  assert.ok(missingResult.diagnostics.length >= 1);
  assert.equal(missingResult.diagnostics[0].code, 'WORKSPACE_MISSING');

  // 2. CLI help flag returns 0
  const helpCode = await main(['--help']);
  assert.equal(helpCode, 0);
});

test('pages-init: scripts/init.sh handles Pages and Gist workflows independently', async (t) => {
  const initScript = path.resolve(projectRoot, 'scripts/init.sh');

  // 1. Default: both Pages and Gist workflows exist
  const dirDefault = path.resolve(projectRoot, '.cache/test-init-default-both');
  await rm(dirDefault, { recursive: true, force: true });
  t.after(() => rm(dirDefault, { recursive: true, force: true }));

  const resDefault = await exec(initScript, ['--yes', '--dir', dirDefault]);
  assert.ok(resDefault.stdout.includes('Successfully initialized skcb project'));

  const hasPagesWfDefault = await stat(path.join(dirDefault, '.github/workflows/pages.yml')).then(() => true).catch(() => false);
  const hasGistWfDefault = await stat(path.join(dirDefault, '.github/workflows/publish-gist.yml')).then(() => true).catch(() => false);
  const hasPagesScriptDefault = await stat(path.join(dirDefault, 'scripts/validate-profiles.mjs')).then(() => true).catch(() => false);
  const hasGistScriptDefault = await stat(path.join(dirDefault, 'scripts/publish-gist.mjs')).then(() => true).catch(() => false);

  assert.equal(hasPagesWfDefault, true, 'Default must include pages.yml');
  assert.equal(hasGistWfDefault, true, 'Default must include publish-gist.yml');
  assert.equal(hasPagesScriptDefault, true, 'Default must include validate-profiles.mjs');
  assert.equal(hasGistScriptDefault, true, 'Default must include publish-gist.mjs');

  // 2. --no-pages-action: Pages workflow and script removed, Gist workflow and script preserved
  const dirNoPages = path.resolve(projectRoot, '.cache/test-init-no-pages');
  await rm(dirNoPages, { recursive: true, force: true });
  t.after(() => rm(dirNoPages, { recursive: true, force: true }));

  const resNoPages = await exec(initScript, ['--yes', '--dir', dirNoPages, '--no-pages-action']);
  assert.ok(resNoPages.stdout.includes('Successfully initialized skcb project'));

  const hasPagesWfNoPages = await stat(path.join(dirNoPages, '.github/workflows/pages.yml')).then(() => true).catch(() => false);
  const hasPagesScriptNoPages = await stat(path.join(dirNoPages, 'scripts/validate-profiles.mjs')).then(() => true).catch(() => false);
  const hasGistWfNoPages = await stat(path.join(dirNoPages, '.github/workflows/publish-gist.yml')).then(() => true).catch(() => false);
  const hasGistScriptNoPages = await stat(path.join(dirNoPages, 'scripts/publish-gist.mjs')).then(() => true).catch(() => false);

  assert.equal(hasPagesWfNoPages, false, '--no-pages-action must remove pages.yml');
  assert.equal(hasPagesScriptNoPages, false, '--no-pages-action must remove validate-profiles.mjs');
  assert.equal(hasGistWfNoPages, true, '--no-pages-action must preserve publish-gist.yml');
  assert.equal(hasGistScriptNoPages, true, '--no-pages-action must preserve publish-gist.mjs');

  // 3. --no-gist-action: Gist workflow and script removed, Pages workflow and script preserved
  const dirNoGist = path.resolve(projectRoot, '.cache/test-init-no-gist-preserve-pages');
  await rm(dirNoGist, { recursive: true, force: true });
  t.after(() => rm(dirNoGist, { recursive: true, force: true }));

  const resNoGist = await exec(initScript, ['--yes', '--dir', dirNoGist, '--no-gist-action']);
  assert.ok(resNoGist.stdout.includes('Successfully initialized skcb project'));

  const hasPagesWfNoGist = await stat(path.join(dirNoGist, '.github/workflows/pages.yml')).then(() => true).catch(() => false);
  const hasPagesScriptNoGist = await stat(path.join(dirNoGist, 'scripts/validate-profiles.mjs')).then(() => true).catch(() => false);
  const hasGistWfNoGist = await stat(path.join(dirNoGist, '.github/workflows/publish-gist.yml')).then(() => true).catch(() => false);
  const hasGistScriptNoGist = await stat(path.join(dirNoGist, 'scripts/publish-gist.mjs')).then(() => true).catch(() => false);

  assert.equal(hasPagesWfNoGist, true, '--no-gist-action must preserve pages.yml');
  assert.equal(hasPagesScriptNoGist, true, '--no-gist-action must preserve validate-profiles.mjs');
  assert.equal(hasGistWfNoGist, false, '--no-gist-action must remove publish-gist.yml');
  assert.equal(hasGistScriptNoGist, false, '--no-gist-action must remove publish-gist.mjs');

  // 4. Both --no-pages-action and --no-gist-action: neither exists, directories cleaned up
  const dirNeither = path.resolve(projectRoot, '.cache/test-init-neither');
  await rm(dirNeither, { recursive: true, force: true });
  t.after(() => rm(dirNeither, { recursive: true, force: true }));

  const resNeither = await exec(initScript, [
    '--yes',
    '--dir', dirNeither,
    '--no-pages-action',
    '--no-gist-action'
  ]);
  assert.ok(resNeither.stdout.includes('Successfully initialized skcb project'));

  const hasWorkflowsDir = await stat(path.join(dirNeither, '.github/workflows')).then(() => true).catch(() => false);
  const hasScriptsDir = await stat(path.join(dirNeither, 'scripts')).then(() => true).catch(() => false);

  assert.equal(hasWorkflowsDir, false, 'workflows directory should be cleaned up when empty');
  assert.equal(hasScriptsDir, false, 'scripts directory should be cleaned up when empty');
});
