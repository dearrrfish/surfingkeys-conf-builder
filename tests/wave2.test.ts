import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import Ajv from 'ajv';
import {fixture} from './helpers.ts';
import {workspace} from '../packages/core/dist/input.js';
import {loadMetadataCatalog} from '../packages/core/dist/catalog.js';
import {resolveProfile, explain} from '../packages/core/dist/profiles.js';
import {
  ADAPTER_TARGET_SHA,
  verifyUpstreamSubmodule
} from '../packages/lib-b0o/dist-adapter/adapter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

test('wave2: upstream submodule SHA matches pinned commit and clean status', async () => {
  const upstreamDir = path.resolve(projectRoot, 'packages/lib-b0o/upstream');
  const sha = await verifyUpstreamSubmodule(upstreamDir);
  assert.equal(sha, ADAPTER_TARGET_SHA);
  assert.equal(sha, '80176490f6d04c61d10bcbc20618bd283b94ca23');
});

test('wave2: verifyUpstreamSubmodule fails closed on missing git marker', async () => {
  const tmpDir = path.resolve(projectRoot, '.cache');
  await assert.rejects(
    () => verifyUpstreamSubmodule(tmpDir),
    (e: any) => e.code === 'SOURCE_GIT_REQUIRED' && e.exitCode === 3
  );
});

test('wave2: generated lib-b0o selective.json satisfies manifest schema', async () => {
  const manifestSchemaPath = path.resolve(projectRoot, 'packages/core/schemas/manifest.schema.json');
  const manifestSchema = JSON.parse(await readFile(manifestSchemaPath, 'utf8'));

  const ajv = new Ajv({allErrors: true});
  const validator = ajv.compile(manifestSchema);

  const selectivePath = path.resolve(projectRoot, 'packages/lib-b0o/dist/selective.json');
  const selective = JSON.parse(await readFile(selectivePath, 'utf8'));

  const valid = validator(selective);
  assert.equal(valid, true, JSON.stringify(validator.errors, null, 2));

  assert.equal(selective.namespace, 'b0o');
  assert.ok(selective.entries['actions.amazon']);
  assert.ok(selective.entries['actions.github']);
  assert.ok(selective.entries['search-engines.ddg']);
  assert.ok(selective.entries['search-engines.google']);

  // Check bilingual description
  const amazon = selective.entries['actions.amazon'];
  assert.ok(amazon.description.en);
  assert.ok(amazon.description['zh-CN']);
  assert.ok(amazon.contributions.some((c: any) => c.id === 'fakespot' && c.description['zh-CN']));
});

test('wave2: lib-b0o dist includes MV3 storage guard, license and notice', async () => {
  const distDir = path.resolve(projectRoot, 'packages/lib-b0o/dist');

  const utilContent = await readFile(path.join(distDir, 'shared/util.js'), 'utf8');
  assert.ok(utilContent.includes('browser?.storage?.local'));

  const licenseContent = await readFile(path.join(distDir, 'LICENSE'), 'utf8');
  assert.ok(licenseContent.includes('Maddison Cohodas'));

  const noticeContent = await readFile(path.join(distDir, 'NOTICE'), 'utf8');
  assert.ok(noticeContent.includes(ADAPTER_TARGET_SHA));
});

test('wave2: consumer workspace can load @skcb/lib-b0o via b0o/* and upstream/* alias', async t => {
  const f = await fixture();
  t.after(f.cleanup);

  const b0oDist = path.resolve(projectRoot, 'packages/lib-b0o/dist');

  // Configure workspace with lib-b0o dist
  await f.write('surfingkeys.workspace.json', {
    schemaVersion: 2,
    libraries: [b0oDist],
    profilesDir: 'profiles',
    outDir: 'dist'
  });

  const ctx = await workspace(f.ctx.file);
  const catalog = await loadMetadataCatalog(ctx);

  // Both b0o/actions.amazon and upstream/actions.amazon should exist in the catalog
  assert.ok(catalog.entries.some(e => e.id === 'b0o/actions.amazon'));
  assert.ok(catalog.entries.some(e => e.id === 'upstream/actions.amazon'));
  assert.ok(catalog.entries.some(e => e.id === 'b0o/search-engines.ddg'));
  assert.ok(catalog.entries.some(e => e.id === 'upstream/search-engines.ddg'));

  // Profile using modern b0o/* namespace
  await f.write('profiles/modern.json', {
    schemaVersion: 2,
    id: 'modern',
    selectAdd: ['b0o/actions.amazon', 'b0o/search-engines.ddg']
  });

  const pModern = await resolveProfile(ctx, 'modern', catalog);
  const explModern: any = explain(pModern, catalog);
  assert.equal(explModern.contributions.length, 9);

  // Profile using legacy upstream/* namespace
  await f.write('profiles/legacy.json', {
    schemaVersion: 2,
    id: 'legacy',
    selectAdd: ['upstream/actions.amazon', 'upstream/search-engines.ddg']
  });

  const pLegacy = await resolveProfile(ctx, 'legacy', catalog);
  const explLegacy: any = explain(pLegacy, catalog);
  assert.equal(explLegacy.contributions.length, 9);
});
