import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {fixture} from './helpers.ts';
import {workspace} from '../packages/core/dist/input.js';
import {loadMetadataCatalog} from '../packages/core/dist/catalog.js';
import {resolveProfile, explain} from '../packages/core/dist/profiles.js';
import {defineSite, defineModule} from '../packages/core/dist/define-site.js';
import {RUNTIME_STORAGE_CODE} from '../packages/core/dist/secret-storage.js';
import {createVisualServer} from '../packages/ui/dist/server.js';

test('wave1: Workspace v2 schema supports libraries array and relative paths', async t => {
  const f = await fixture();
  t.after(f.cleanup);

  // Write a v2 workspace
  await f.write('surfingkeys.workspace.json', {
    schemaVersion: 2,
    libraries: ['./extension'],
    profilesDir: 'profiles',
    outDir: 'dist'
  });

  const ctx = await workspace(f.ctx.file);
  assert.equal(ctx.workspace.schemaVersion, 2);
  assert.equal(ctx.extensions.length, 1);
  const path = await import('node:path');
  assert.equal(ctx.profilesDir, path.join(f.root, 'profiles'));
  assert.equal(ctx.outDir, path.join(f.root, 'dist'));
});

test('wave1: selectRemoveContributions allows granular suppression of individual mapkeys', async t => {
  const f = await fixture();
  t.after(f.cleanup);

  // Two contributions in the same entry
  await f.write('extension/selective.json', {
    schemaVersion: 1,
    namespace: 'notes',
    entries: {
      'actions.notes': {
        entry: 'entry.js',
        contributions: [
          {id: 'first', kind: 'mapkey', alias: 'h', domain: 'global'},
          {id: 'second', kind: 'mapkey', alias: 'k', domain: 'global'}
        ]
      }
    }
  });

  const c = await loadMetadataCatalog(f.ctx);

  // Profile selects notes/actions.notes but disables 'second'
  await f.write('profiles/personal.json', {
    schemaVersion: 2,
    id: 'personal',
    selectAdd: ['notes/actions.notes'],
    selectRemoveContributions: ['notes/actions.notes#second']
  });

  const p = await resolveProfile(f.ctx, 'personal', c);
  assert.deepEqual(p.selectRemoveContributions, ['notes/actions.notes#second']);

  const expl: any = explain(p, c);
  // 'first' should be included in contributions, 'second' should be in removedContributions
  const activeIds = expl.contributions.map((x: any) => x.id);
  assert.ok(activeIds.includes('notes/actions.notes#first'));
  assert.ok(!activeIds.includes('notes/actions.notes#second'));
  assert.ok(expl.removedContributions.includes('notes/actions.notes#second'));
});

test('wave1: conflictResolution module-precedence resolves conflicting mapkeys by library priority', async t => {
  const f = await fixture();
  t.after(f.cleanup);

  // Extension with a global mapkey 'x' across two different namespaces
  await f.write('extension/selective.json', {
    schemaVersion: 1,
    namespace: 'custom',
    entries: {
      'actions.one': {
        entry: 'entry.js',
        contributions: [
          {id: 'custom-x', kind: 'mapkey', alias: 'x', domain: 'global'}
        ]
      }
    }
  });

  // Second extension with namespace 'other'
  const {mkdir} = await import('node:fs/promises');
  const path = await import('node:path');
  await mkdir(path.join(f.root, 'other-ext'), {recursive: true});
  await f.write('other-ext/selective.json', {
    schemaVersion: 1,
    namespace: 'other',
    entries: {
      'actions.two': {
        entry: 'entry.js',
        contributions: [
          {id: 'other-x', kind: 'mapkey', alias: 'x', domain: 'global'}
        ]
      }
    }
  });
  await f.write('other-ext/entry.js', 'export default () => ({callbacks:{}});');

  // Update workspace to include both extensions
  await f.write('surfingkeys.workspace.json', {
    schemaVersion: 2,
    libraries: ['./extension', './other-ext'],
    profilesDir: 'profiles',
    outDir: 'dist'
  });

  const ctx = await workspace(f.ctx.file);
  const c = await loadMetadataCatalog(ctx);

  // 1. Strict mode should reject collision
  await f.write('profiles/strict.json', {
    schemaVersion: 2,
    id: 'strict',
    selectAdd: ['custom/actions.one', 'other/actions.two'],
    conflictResolution: {
      mode: 'strict'
    }
  });

  const pStrict = await resolveProfile(ctx, 'strict', c);
  assert.throws(() => explain(pStrict, c), (e: any) => e.diagnostic?.code === 'REGISTRATION_CONFLICT');

  // 2. Module precedence mode should pick the preferred namespace
  await f.write('profiles/precedence.json', {
    schemaVersion: 2,
    id: 'precedence',
    selectAdd: ['custom/actions.one', 'other/actions.two'],
    conflictResolution: {
      mode: 'module-precedence',
      modulePrecedence: ['other', 'custom']
    }
  });

  const pPrecedence = await resolveProfile(ctx, 'precedence', c);
  const explPrecedence: any = explain(pPrecedence, c);
  const active = explPrecedence.contributions.map((x: any) => x.id);
  assert.ok(active.includes('other/actions.two#other-x'));
  assert.ok(!active.includes('custom/actions.one#custom-x'));
  assert.ok(explPrecedence.suppressedContributions.includes('custom/actions.one#custom-x'));
});

test('wave1: defineSite and defineModule SDK generates standard catalog structure', async () => {
  const site = defineSite({
    id: 'bilibili',
    name: 'Bilibili',
    domain: 'bilibili.com',
    actions: {
      togglePlay: {
        keys: 'p',
        description: {en: 'Toggle Play/Pause', 'zh-CN': '播放/暂停'},
        code: () => {}
      }
    },
    searchEngines: {
      video: {
        alias: 'bv',
        name: 'Bilibili Search',
        url: 'https://search.bilibili.com/all?keyword='
      }
    }
  });

  assert.equal(site.id, 'bilibili');
  assert.equal(site.domain, 'bilibili.com');
  assert.ok(site.actions?.togglePlay);
  assert.equal(site.actions?.togglePlay.keys, 'p');
  assert.ok(site.searchEngines?.video);

  const mod = defineModule({
    namespace: 'ent',
    sites: [site]
  });

  assert.equal(mod.namespace, 'ent');
  assert.equal(mod.sites.length, 1);
});

test('wave1: core.secretStorage runtime generates non-empty safe 3-tier helper', () => {
  assert.ok(RUNTIME_STORAGE_CODE.includes('skcbSecretStorage'));
  assert.ok(RUNTIME_STORAGE_CODE.includes('browser.storage.local'));
  assert.ok(RUNTIME_STORAGE_CODE.includes('chrome.storage.local'));
  assert.ok(RUNTIME_STORAGE_CODE.includes('skcbSecrets'));
});

test('wave1: visual server supports --serve-only and --token modes', async t => {
  const f = await fixture();
  t.after(f.cleanup);

  const server = await createVisualServer({
    workspacePath: f.ctx.file,
    port: 0,
    host: '127.0.0.1',
    serveOnly: true,
    token: 'super-secret-token'
  });

  await server.start();
  t.after(server.stop);

  const port = (server as any).server.address().port;

  // 1. Unauthenticated request should return 401
  const unauthRes = await makeRequest(`http://127.0.0.1:${port}/api/catalog`);
  assert.equal(unauthRes.statusCode, 401);

  // 2. Authenticated request with Bearer token should succeed
  const authRes = await makeRequest(`http://127.0.0.1:${port}/api/catalog`, {
    headers: {Authorization: 'Bearer super-secret-token'}
  });
  assert.equal(authRes.statusCode, 200);

  // 3. Authenticated request with query parameter token should succeed
  const queryAuthRes = await makeRequest(`http://127.0.0.1:${port}/api/catalog?token=super-secret-token`);
  assert.equal(queryAuthRes.statusCode, 200);

  // 4. In --serve-only mode, mutation endpoints (e.g. POST /api/build) must return 403 Forbidden
  const buildRes = await makeRequest(`http://127.0.0.1:${port}/api/build`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer super-secret-token',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({profileId: 'personal'})
  });
  assert.equal(buildRes.statusCode, 403);
});

function makeRequest(urlStr: string, options: {method?: string; headers?: Record<string, string>; body?: string} = {}): Promise<{statusCode: number; body: string}> {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: options.method || 'GET',
      headers: options.headers || {}
    }, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve({statusCode: res.statusCode || 0, body: data}));
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}
