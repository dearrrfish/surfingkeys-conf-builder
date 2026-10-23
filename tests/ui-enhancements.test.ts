import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile, rm, mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createVisualServer} from '../packages/ui/dist/server.js';
import {workspace, loadMetadataCatalog, resolveProfile, explain, registration} from '../packages/core/dist/index.js';
import type {Profile, EffectiveProfile, Catalog} from '../packages/core/dist/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

test('ui-enhancements: 1. data completeness - lib-b0o exports all search engines and omnibar', async () => {
  const b0oSelectivePath = path.resolve(projectRoot, 'packages/lib-b0o/dist/selective.json');
  const b0oSelective = JSON.parse(await readFile(b0oSelectivePath, 'utf8'));

  // 1. Omnibar history exists
  assert.ok(b0oSelective.entries['omnibar.history'], 'omnibar.history must be exported');
  const omnibarEntry = b0oSelective.entries['omnibar.history'];
  assert.deepEqual(omnibarEntry.capabilities, ['core.omnibar']);
  assert.equal(omnibarEntry.contributions[0].kind, 'omnibar');
  assert.equal(omnibarEntry.contributions[0].alias, 'oh');

  // 2. Search engines count: 58 search engines
  const searchEngineEntries = Object.keys(b0oSelective.entries).filter(k => k.startsWith('search-engines.'));
  assert.equal(searchEngineEntries.length, 58, `Expected 58 search engines in lib-b0o, got ${searchEngineEntries.length}`);

  // 3. UI index.html category parsing fix
  const uiHtml = await readFile(path.resolve(projectRoot, 'packages/ui/ui/index.html'), 'utf8');
  assert.ok(uiHtml.includes("localId.startsWith('search-engines.') || localId.startsWith('search.')"), 'UI must classify search-engines correctly');
  assert.ok(!uiHtml.includes("localId.startsWith('search-engines.') ? 'search' : 'omnibar'"), 'Old buggy search category string must be removed');
});

test('ui-enhancements: 2. right inspector scroll overflow fix using modern flexbox', async () => {
  const uiHtml = await readFile(path.resolve(projectRoot, 'packages/ui/ui/index.html'), 'utf8');

  // Must NOT have the old broken calc(100vh - 320px)
  assert.ok(!uiHtml.includes('max-height: calc(100vh - 320px);'), 'Old fixed 320px scroll height must be removed');

  // Must have Flexbox viewport bounds
  assert.ok(uiHtml.includes('height: calc(100vh - 84px);'), 'Right column must have explicit bounded viewport height');
  assert.ok(uiHtml.includes('.right-column > .card'), 'Right column card must expand to 100% of column');
  assert.ok(uiHtml.includes('padding-bottom: 2.5rem;'), 'Scroll container must have bottom breathing room');
});

test('ui-enhancements: 3. left column dynamic lib pills and hierarchy vs flat views', async () => {
  const uiHtml = await readFile(path.resolve(projectRoot, 'packages/ui/ui/index.html'), 'utf8');

  // 1. Dynamic lib pills function
  assert.ok(uiHtml.includes('function renderLibPills()'), 'renderLibPills must be implemented');
  assert.ok(uiHtml.includes('libCounts.set(lib'), 'Lib pills must count dynamically from CATALOG');

  // 2. View mode buttons
  assert.ok(uiHtml.includes('id="btn-view-hierarchy"'), 'Hierarchy view button must exist');
  assert.ok(uiHtml.includes('id="btn-view-flat"'), 'Flat view button must exist');

  // 3. Dual view mode rendering
  assert.ok(uiHtml.includes('state.viewMode === "hierarchy"'), 'renderCatalog must support hierarchy mode');
  assert.ok(uiHtml.includes('catalog-group-lib-header'), 'Hierarchy mode must render lib header');
  assert.ok(uiHtml.includes('catalog-group-domain-header'), 'Both modes must render domain header');
  assert.ok(uiHtml.includes('catalog-group-cat-header'), 'Both modes must render category sub-headers only in all view');
});

test('ui-enhancements: 4. right column keybinding inline edit and real-time conflict gate', async () => {
  const uiHtml = await readFile(path.resolve(projectRoot, 'packages/ui/ui/index.html'), 'utf8');

  // 1. Conflict gate & editing methods
  assert.ok(uiHtml.includes('window.checkKeybindingConflict'), 'checkKeybindingConflict must exist');
  assert.ok(uiHtml.includes('window.startEditKeybinding'), 'startEditKeybinding must exist');
  assert.ok(uiHtml.includes('window.saveKeybindingEdit'), 'saveKeybindingEdit must exist');
  assert.ok(uiHtml.includes('window.resetKeybinding'), 'resetKeybinding must exist');
  assert.ok(uiHtml.includes('keymap-inline-editor'), 'Inline editor UI must exist');

  // 2. Core engine keybindings conflict gate integration
  const catalog: Catalog = {
    entries: [
      {
        id: 'tech/actions.github',
        source: 'packages/lib-tech',
        entry: 'actions/github.js',
        description: 'GitHub actions',
        contributions: [
          {id: 'notifications', alias: 'gn', kind: 'mapkey', domain: 'github.com'},
          {id: 'issues', alias: 'gi', kind: 'mapkey', domain: 'github.com'}
        ]
      }
    ]
  };

  const effectiveProfile: EffectiveProfile = {
    id: 'test-profile',
    locale: 'zh-CN',
    abstract: false,
    base: 'minimal',
    select: ['tech/actions.github'],
    selectRemoveContributions: [],
    conflictResolution: {mode: 'strict', modulePrecedence: ['tech']},
    leaders: {site: '<Space>', search: 'a'},
    settings: {},
    overrides: [],
    provenance: {},
    keybindings: {
      'tech/actions.github#issues': 'gn' // Collision with notifications!
    }
  };

  // In strict mode, duplicate alias collision must be intercepted as REGISTRATION_CONFLICT
  assert.throws(
    () => explain(effectiveProfile, catalog),
    (err: any) => err.diagnostic?.code === 'REGISTRATION_CONFLICT'
  );

  // When conflict is resolved with non-colliding alias
  effectiveProfile.keybindings = {'tech/actions.github#issues': 'gI'};
  const explained = explain(effectiveProfile, catalog);
  assert.equal(explained.contributions.length, 2);
  const issuesItem = explained.contributions.find(p => p.id.endsWith('#issues'));
  assert.ok(issuesItem);
  assert.equal(issuesItem.alias, 'gI');

  // Registration plan maps the customized alias to keys
  const reg = registration({...catalog.entries[0].contributions[1], alias: 'gI', featureId: 'tech/actions.github'}, effectiveProfile);
  assert.deepEqual(reg.keys, ['<Space>gI']);
});

test('ui-enhancements: 5. visual server REST APIs handle keybindings and catalog', async (t) => {
  const tempDir = path.resolve(projectRoot, '.cache/test-ui-server');
  await rm(tempDir, {recursive: true, force: true});
  await mkdir(path.join(tempDir, 'profiles'), {recursive: true});

  t.after(() => rm(tempDir, {recursive: true, force: true}));

  const b0oDir = path.resolve(projectRoot, 'packages/lib-b0o/dist');
  const techDir = path.resolve(projectRoot, 'packages/lib-tech/dist');

  const wsPath = path.join(tempDir, 'surfingkeys.workspace.json');
  const wsContent = {
    schemaVersion: 2,
    libraries: [b0oDir, techDir],
    profilesDir: 'profiles',
    outDir: 'dist'
  };
  const {writeFile} = await import('node:fs/promises');
  await writeFile(wsPath, JSON.stringify(wsContent, null, 2), 'utf8');

  // Start visual server
  const server = await createVisualServer({
    workspacePath: wsPath,
    port: 0,
    host: '127.0.0.1'
  });
  await server.start();
  t.after(async () => {
    await server.stop();
  });

  const address = server.server.address();
  assert.ok(address && typeof address === 'object');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  // 1. GET /api/catalog
  const catRes = await fetch(`${baseUrl}/api/catalog`);
  assert.equal(catRes.status, 200);
  const catData = await catRes.json() as any;
  assert.equal(catData.ok, true);
  assert.ok(catData.catalog.entries.some((e: any) => e.id === 'b0o/omnibar.history'));
  assert.ok(catData.catalog.entries.some((e: any) => e.id === 'b0o/search-engines.google'));

  // 2. POST /api/profiles/save with custom keybindings
  const profileToSave: Profile = {
    schemaVersion: 2,
    id: 'custom-dev',
    locale: 'zh-CN',
    abstract: false,
    conflictResolution: {mode: 'module-precedence', modulePrecedence: ['tech', 'b0o']},
    leaders: {site: '<Space>', search: 'a'},
    settings: {defaultSearchEngine: 'du'},
    selectAdd: ['tech/actions.github', 'b0o/search-engines.ddg'],
    keybindings: {
      'tech/actions.github#clipboard-repo': '\\myrepo'
    }
  };

  const saveRes = await fetch(`${baseUrl}/api/profiles/save`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(profileToSave)
  });
  assert.equal(saveRes.status, 200);
  const saveData = await saveRes.json() as any;
  assert.equal(saveData.ok, true);

  // Verify file on disk
  const savedFile = JSON.parse(await readFile(path.join(tempDir, 'profiles/custom-dev.json'), 'utf8'));
  assert.equal(savedFile.id, 'custom-dev');
  assert.deepEqual(savedFile.keybindings, {'tech/actions.github#clipboard-repo': '\\myrepo'});

  // 3. POST /api/validate with keybindings
  const valRes = await fetch(`${baseUrl}/api/validate`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(profileToSave)
  });
  assert.equal(valRes.status, 200);
  const valData = await valRes.json() as any;
  assert.equal(valData.ok, true);
  assert.equal(valData.valid, true);
});
