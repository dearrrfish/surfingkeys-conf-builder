import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile, writeFile, mkdir, rm, stat} from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fixture, project} from './helpers.ts';
import {exportStaticSite} from '../packages/ui/dist/server.js';
import {Failure} from '../packages/core/dist/index.js';

const exec = promisify(execFile);

test('static-export: generates complete file set and manifest with catalog and profiles metadata', async (t) => {
  const f = await fixture(false);
  t.after(f.cleanup);

  // Setup profiles including nested profile
  await rm(path.join(f.root, 'profiles', 'personal.json'), {force: true});
  await mkdir(path.join(f.root, 'profiles', 'nested'), {recursive: true});
  await f.write('profiles/common.json', {
    schemaVersion: 1,
    id: 'common',
    abstract: true,
    locale: 'zh-CN',
    selectAdd: ['upstream/search-engines.ddg'],
    settings: {defaultSearchEngine: 'du'},
    leaders: {site: 's'}
  });
  await f.write('profiles/nested/personal.json', {
    schemaVersion: 1,
    id: 'personal',
    abstract: false,
    extends: '../common.json',
    locale: 'zh-CN',
    selectAdd: ['notes/actions.notes'],
    settings: {someSecret: 'hidden-secret'},
    keybindings: {'notes/actions.notes#home': '<Space>t'}
  });
  await f.write('profiles/work.json', {
    schemaVersion: 1,
    id: 'work',
    abstract: false,
    extends: './common.json',
    locale: 'en',
    selectRemove: ['upstream/search-engines.ddg']
  });

  const ws = path.join(f.root, 'surfingkeys.workspace.json');
  const outDir = path.join(f.root, '.pages');

  const res = await exportStaticSite({
    workspacePath: ws,
    outDir,
    repository: 'my-org/my-conf',
    baseBranch: 'main',
    now: '2026-10-28T12:00:00.000Z'
  });

  assert.equal(res.outDir, outDir);
  assert.deepEqual(res.files, [
    '.nojekyll',
    'data/catalog.json',
    'data/profiles.json',
    'index.html',
    'manifest.json'
  ]);

  // 1. .nojekyll is empty
  const nojekyll = await readFile(path.join(outDir, '.nojekyll'), 'utf8');
  assert.equal(nojekyll, '');

  // 2. manifest.json
  const manifestRaw = await readFile(path.join(outDir, 'manifest.json'), 'utf8');
  const manifest = JSON.parse(manifestRaw);
  assert.equal(manifest.generator, 'skcb-static');
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.generatedAt, '2026-10-28T12:00:00.000Z');
  assert.equal(manifest.repository, 'my-org/my-conf');
  assert.equal(manifest.baseBranch, 'main');
  assert.ok(manifest.catalogEntries > 0);
  assert.equal(manifest.profiles.length, 3);

  // Profiles metadata in manifest & profiles.json are sorted by id ascending
  assert.deepEqual(manifest.profiles.map((p: any) => p.id), ['common', 'personal', 'work']);

  // 3. data/profiles.json
  const profilesRaw = await readFile(path.join(outDir, 'data', 'profiles.json'), 'utf8');
  const profilesData = JSON.parse(profilesRaw);
  assert.equal(profilesData.schemaVersion, 1);
  assert.equal(profilesData.profiles.length, 3);

  const commonMeta = profilesData.profiles.find((p: any) => p.id === 'common');
  assert.deepEqual(commonMeta, {
    id: 'common',
    abstract: true,
    locale: 'zh-CN',
    file: 'profiles/common.json'
  });

  const personalMeta = profilesData.profiles.find((p: any) => p.id === 'personal');
  assert.deepEqual(personalMeta, {
    id: 'personal',
    abstract: false,
    extends: '../common.json',
    locale: 'zh-CN',
    file: 'profiles/nested/personal.json'
  });

  // Verify file paths use '/' forward slashes
  assert.ok(!personalMeta.file.includes('\\'));

  // 4. data/catalog.json
  const catalogRaw = await readFile(path.join(outDir, 'data', 'catalog.json'), 'utf8');
  const catalogData = JSON.parse(catalogRaw);
  assert.equal(catalogData.schemaVersion, 1);
  assert.ok(Array.isArray(catalogData.catalog.entries));
  assert.ok(catalogData.catalog.entries.length > 0);

  // 5. index.html static config injection
  const html = await readFile(path.join(outDir, 'index.html'), 'utf8');
  assert.ok(html.includes('<meta http-equiv="Content-Security-Policy"'));
  assert.ok(html.includes('<script id="skcb-static-config" type="application/json">'));
  const configMatch = html.match(/<script id="skcb-static-config" type="application\/json">([\s\S]*?)<\/script>/);
  assert.ok(configMatch);
  const injectedConfig = JSON.parse(configMatch[1]);
  assert.equal(injectedConfig.schemaVersion, 1);
  assert.equal(injectedConfig.mode, 'static');
  assert.equal(injectedConfig.generator, 'skcb-static');
  assert.equal(injectedConfig.repository, 'my-org/my-conf');
  assert.equal(injectedConfig.baseBranch, 'main');
  assert.equal(injectedConfig.catalog, 'data/catalog.json');
  assert.equal(injectedConfig.profiles, 'data/profiles.json');
});

test('static-export: privacy and minimal publication - strictly no secrets, no body, no absolute paths', async (t) => {
  const f = await fixture(false);
  t.after(f.cleanup);

  await f.write('profiles/personal.json', {
    schemaVersion: 1,
    id: 'personal',
    selectAdd: ['notes/actions.notes'],
    selectRemove: ['upstream/search-engines.ddg'],
    selectRemoveContributions: ['notes/actions.notes#home'],
    settings: {
      defaultSearchEngine: 'du',
      superSecretApiKey: 'SECRET_123456789'
    },
    keybindings: {'notes/actions.notes#home': '<Space>p'},
    overrides: [{target: 'notes/actions.notes#home', with: 'upstream/actions.amazon#cart'}]
  });

  const ws = path.join(f.root, 'surfingkeys.workspace.json');
  const outDir = path.join(f.root, '.pages');

  await exportStaticSite({
    workspacePath: ws,
    outDir
  });

  const profilesContent = await readFile(path.join(outDir, 'data', 'profiles.json'), 'utf8');
  assert.ok(!profilesContent.includes('SECRET_123456789'));
  assert.ok(!profilesContent.includes('selectAdd'));
  assert.ok(!profilesContent.includes('selectRemove'));
  assert.ok(!profilesContent.includes('selectRemoveContributions'));
  assert.ok(!profilesContent.includes('settings'));
  assert.ok(!profilesContent.includes('keybindings'));
  assert.ok(!profilesContent.includes('overrides'));
  assert.ok(!profilesContent.includes('superSecretApiKey'));

  // Assert NO local filesystem absolute root paths exist in any exported file
  for (const filename of ['.nojekyll', 'data/catalog.json', 'data/profiles.json', 'index.html', 'manifest.json']) {
    const content = await readFile(path.join(outDir, filename), 'utf8');
    assert.ok(!content.includes(f.root), `File ${filename} must not contain absolute workspace path`);
    assert.ok(!content.includes('/home/'), `File ${filename} must not contain absolute path`);
    assert.ok(!content.includes('report.json'));
    assert.ok(!content.includes('sources.lock.json'));
  }
});

test('static-export: escapes < to \\u003c in injected static config JSON', async (t) => {
  const f = await fixture(false);
  t.after(f.cleanup);

  const ws = path.join(f.root, 'surfingkeys.workspace.json');
  const outDir = path.join(f.root, '.pages-escape');

  await exportStaticSite({
    workspacePath: ws,
    outDir,
    repository: 'owner/<script>alert("xss")</script>',
    baseBranch: 'feat/<special>'
  });

  const html = await readFile(path.join(outDir, 'index.html'), 'utf8');
  // Raw script tag closing must not be present in injected config
  assert.ok(!html.includes('</script>alert'));
  assert.ok(html.includes('\\u003cscript>alert'));
});

test('static-export: repeated export into existing skcb-static outDir succeeds idempotently', async (t) => {
  const f = await fixture(false);
  t.after(f.cleanup);

  const ws = path.join(f.root, 'surfingkeys.workspace.json');
  const outDir = path.join(f.root, '.pages-repeat');

  const res1 = await exportStaticSite({workspacePath: ws, outDir});
  assert.equal(res1.files.length, 5);

  const res2 = await exportStaticSite({workspacePath: ws, outDir});
  assert.equal(res2.files.length, 5);

  const manifest = JSON.parse(await readFile(path.join(outDir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.generator, 'skcb-static');
});

test('static-export: refuses to overwrite non-skcb-static non-empty directory and preserves user files', async (t) => {
  const f = await fixture(false);
  t.after(f.cleanup);

  const ws = path.join(f.root, 'surfingkeys.workspace.json');
  const outDir = path.join(f.root, 'custom-nonempty');
  await mkdir(outDir, {recursive: true});
  await writeFile(path.join(outDir, 'precious-user-file.txt'), 'do-not-delete');

  await assert.rejects(
    async () => {
      await exportStaticSite({workspacePath: ws, outDir});
    },
    (err: any) => {
      assert.ok(err instanceof Failure || err.code === 'OUTPUT_PATH_INVALID');
      assert.equal(err.diagnostic?.code, 'OUTPUT_PATH_INVALID');
      return true;
    }
  );

  // Assert user file was untouched
  const content = await readFile(path.join(outDir, 'precious-user-file.txt'), 'utf8');
  assert.equal(content, 'do-not-delete');
});

test('static-export: rejects unsafe output paths (workspace root, inside profiles, inside extensions, private paths)', async (t) => {
  const f = await fixture(false);
  t.after(f.cleanup);

  const ws = path.join(f.root, 'surfingkeys.workspace.json');

  // 1. Equal to workspace root
  await assert.rejects(
    () => exportStaticSite({workspacePath: ws, outDir: f.root}),
    (err: any) => err.diagnostic?.code === 'OUTPUT_PATH_INVALID'
  );

  // 2. Inside profiles directory
  await assert.rejects(
    () => exportStaticSite({workspacePath: ws, outDir: path.join(f.root, 'profiles', 'pages')}),
    (err: any) => err.diagnostic?.code === 'OUTPUT_PATH_INVALID'
  );

  // 3. Inside extension source root
  await assert.rejects(
    () => exportStaticSite({workspacePath: ws, outDir: path.join(f.root, 'extension', 'pages')}),
    (err: any) => err.diagnostic?.code === 'OUTPUT_PATH_INVALID'
  );

  // 4. Private path
  await assert.rejects(
    () => exportStaticSite({workspacePath: ws, outDir: path.join(f.root, '.env.pages')}),
    (err: any) => err.diagnostic?.code === 'OUTPUT_PATH_INVALID'
  );
});

test('static-export: rejects duplicate profile id across different files with PROFILE_DUPLICATE', async (t) => {
  const f = await fixture(false);
  t.after(f.cleanup);

  await mkdir(path.join(f.root, 'profiles', 'sub'), {recursive: true});
  await f.write('profiles/sub/work-clone.json', {
    schemaVersion: 1,
    id: 'work', // Duplicate id of profiles/work.json
    extends: '../common.json'
  });

  const ws = path.join(f.root, 'surfingkeys.workspace.json');
  const outDir = path.join(f.root, '.pages-dup');

  await assert.rejects(
    () => exportStaticSite({workspacePath: ws, outDir}),
    (err: any) => {
      assert.equal(err.diagnostic?.code, 'PROFILE_DUPLICATE');
      return true;
    }
  );
});

test('static-export: CLI skcb-ui --export-static with --json outputs valid JSON and respects arguments', async (t) => {
  const f = await fixture(false);
  t.after(f.cleanup);

  const ws = path.join(f.root, 'surfingkeys.workspace.json');
  const outDir = path.join(f.root, '.pages-cli');
  const serverJs = path.join(project, 'packages', 'ui', 'dist', 'server.js');

  const {stdout} = await exec(process.execPath, [
    serverJs,
    '--export-static',
    '--out', outDir,
    '--workspace', ws,
    '--repository', 'cli-org/cli-repo',
    '--base-branch', 'cli-main',
    '--json'
  ]);

  const parsed = JSON.parse(stdout);
  assert.equal(parsed.outDir, outDir);
  assert.equal(parsed.manifest.repository, 'cli-org/cli-repo');
  assert.equal(parsed.manifest.baseBranch, 'cli-main');
  assert.equal(parsed.files.length, 5);

  const statIndex = await stat(path.join(outDir, 'index.html'));
  assert.ok(statIndex.isFile());
});

test('static-export: CLI exits with code 2 if --out is missing when --export-static is passed', async () => {
  const serverJs = path.join(project, 'packages', 'ui', 'dist', 'server.js');

  await assert.rejects(
    () => exec(process.execPath, [serverJs, '--export-static']),
    (err: any) => {
      assert.equal(err.code, 2);
      assert.ok(err.stderr.includes('--out <dir> is required'));
      return true;
    }
  );
});
