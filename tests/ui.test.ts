import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {createVisualServer} from '../dist-tool/server.js';
import {run} from '../dist-tool/cli.js';
import {fixture, project, integrationAvailable} from './helpers.ts';

test('visual-ui: server hosts static interface and REST APIs', async (t) => {
  const f = await fixture(false);
  t.after(f.cleanup);

  const server = await createVisualServer({
    workspacePath: `${f.root}/surfingkeys.workspace.json`,
    port: 0,
    host: '127.0.0.1',
    uiDir: path.join(project, 'ui')
  });

  await server.start();
  t.after(async () => {
    await server.close();
  });

  const address = server.server.address();
  assert.ok(address && typeof address === 'object');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  // 1. Static file tests
  const htmlRes = await fetch(`${baseUrl}/`);
  assert.equal(htmlRes.status, 200);
  assert.equal(htmlRes.headers.get('content-type'), 'text/html');
  const html = await htmlRes.text();
  assert.ok(html.includes('SurfingKeys 配置视觉构建器'));
  assert.ok(html.includes('tab-create'));
  assert.ok(html.includes('tab-update'));
  assert.ok(html.includes('Omni Bar'));

  const cssRes = await fetch(`${baseUrl}/style.css`);
  assert.equal(cssRes.status, 200);
  assert.equal(cssRes.headers.get('content-type'), 'text/css');

  const jsRes = await fetch(`${baseUrl}/app.js`);
  assert.equal(jsRes.status, 200);
  assert.equal(jsRes.headers.get('content-type'), 'application/javascript');

  // 2. API: GET /api/workspace
  const wsRes = await fetch(`${baseUrl}/api/workspace`);
  assert.equal(wsRes.status, 200);
  const wsData = await wsRes.json() as any;
  assert.equal(wsData.ok, true);
  assert.ok(wsData.workspace.root);
  assert.ok(wsData.workspace.profilesDir);

  // 3. API: GET /api/catalog
  const catRes = await fetch(`${baseUrl}/api/catalog`);
  assert.equal(catRes.status, 200);
  const catData = await catRes.json() as any;
  assert.equal(catData.ok, true);
  assert.ok(catData.catalog.entries.length > 0);
  assert.ok(catData.catalog.entries.some((e: any) => e.id === 'upstream/actions.amazon'));
  assert.ok(catData.catalog.entries.some((e: any) => e.id === 'upstream/search-engines.ddg'));

  // 4. API: GET /api/profiles
  const profilesRes = await fetch(`${baseUrl}/api/profiles`);
  assert.equal(profilesRes.status, 200);
  const profilesData = await profilesRes.json() as any;
  assert.equal(profilesData.ok, true);
  assert.ok(profilesData.profiles.some((p: any) => p.id === 'common' && p.abstract === true));
  assert.ok(profilesData.profiles.some((p: any) => p.id === 'personal'));

  // 5. API: GET /api/profiles/:id
  const singleRes = await fetch(`${baseUrl}/api/profiles/personal`);
  assert.equal(singleRes.status, 200);
  const singleData = await singleRes.json() as any;
  assert.equal(singleData.ok, true);
  assert.equal(singleData.profile.id, 'personal');

  // 6. API: POST /api/validate
  const validProfile = {
    schemaVersion: 1,
    id: 'test-valid',
    extends: 'common.json',
    selectAdd: ['upstream/search-engines.ddg'],
    settings: {
      defaultSearchEngine: 'du'
    }
  };
  const valRes = await fetch(`${baseUrl}/api/validate`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({profile: validProfile})
  });
  assert.equal(valRes.status, 200);
  const valData = await valRes.json() as any;
  assert.equal(valData.ok, true);

  // Invalid profile validation (missing schemaVersion)
  const invalidProfile = {
    id: 'test-invalid',
    selectAdd: ['unknown/feature']
  };
  const invalRes = await fetch(`${baseUrl}/api/validate`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({profile: invalidProfile})
  });
  assert.equal(invalRes.status, 200);
  const invalData = await invalRes.json() as any;
  assert.equal(invalData.ok, false);

  // 7. API: POST /api/profiles/:id (Save new profile)
  const newProfile = {
    schemaVersion: 1,
    id: 'shopping-profile',
    extends: 'common.json',
    selectAdd: ['upstream/actions.amazon'],
    settings: {
      defaultSearchEngine: 'du'
    },
    leaders: {
      site: '<Space>',
      search: 'a'
    }
  };
  const saveRes = await fetch(`${baseUrl}/api/profiles/shopping-profile`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({profile: newProfile})
  });
  assert.equal(saveRes.status, 200);
  const saveData = await saveRes.json() as any;
  assert.equal(saveData.ok, true);

  // Verify file written to profiles/shopping-profile.json
  const savedContent = JSON.parse(await readFile(`${f.root}/profiles/shopping-profile.json`, 'utf8'));
  assert.equal(savedContent.id, 'shopping-profile');
  assert.deepEqual(savedContent.selectAdd, ['upstream/actions.amazon']);

  // Path traversal check: attempts to write outside profilesDir must be rejected
  const maliciousRes = await fetch(`${baseUrl}/api/profiles/..%2Fescaped`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({profile: {...newProfile, id: '../escaped'}})
  });
  assert.equal(maliciousRes.status, 400);

  // 8. API: POST /api/build error checks
  const abstractBuildRes = await fetch(`${baseUrl}/api/build`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({profile: {schemaVersion: 1, id: 'abstract-test', abstract: true}})
  });
  assert.equal(abstractBuildRes.status, 400);
  const abstractBuildData = await abstractBuildRes.json() as any;
  assert.ok(abstractBuildData.error.includes('abstract'));

  // 9. Offline security check: ensure ui/index.html has zero external CDN scripts or resources
  const indexHtmlContent = await readFile(path.join(project, 'ui/index.html'), 'utf8');
  assert.ok(!/https?:\/\//i.test(indexHtmlContent.replace(/http:\/\/json-schema\.org/g, '')), 'HTML must not reference external web URLs for scripts or styles');
  assert.ok(indexHtmlContent.includes('btn-build-script'));
  assert.ok(indexHtmlContent.includes('build-modal'));
});

test('visual-ui: POST /api/build compiles real surfingkeys.js script', {skip: !integrationAvailable}, async (t) => {
  const f = await fixture(true);
  t.after(f.cleanup);

  const ws = `${f.root}/surfingkeys.workspace.json`;
  assert.equal((await run(['sources', 'lock', '--refresh', '--workspace', ws])).exitCode, 0);

  const server = await createVisualServer({
    workspacePath: ws,
    port: 0,
    host: '127.0.0.1',
    uiDir: path.join(project, 'ui')
  });

  await server.start();
  t.after(async () => {
    await server.close();
  });

  const address = server.server.address();
  assert.ok(address && typeof address === 'object');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  // Build real-time personal profile via API
  const buildProfile = {
    schemaVersion: 1,
    id: 'realtime-build-test',
    extends: 'common.json',
    selectAdd: ['upstream/actions.amazon'],
    settings: {
      defaultSearchEngine: 'du'
    }
  };

  const res = await fetch(`${baseUrl}/api/build`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({profile: buildProfile, mode: 'production'})
  });

  assert.equal(res.status, 200);
  const data = await res.json() as any;
  assert.equal(data.ok, true);
  assert.equal(data.profileId, 'realtime-build-test');
  assert.ok(data.buildId);
  assert.ok(data.scriptPath.endsWith('surfingkeys.js'));
  assert.ok(data.scriptContent.includes('SurfingKeys'));
  assert.ok(data.outputs.script.bytes > 0);
  assert.ok(data.analysis.contributionsCount > 0);

  // Test GET /script/:id direct URL serving
  const scriptDirectRes = await fetch(`${baseUrl}/script/realtime-build-test`);
  assert.equal(scriptDirectRes.status, 200);
  assert.equal(scriptDirectRes.headers.get('content-type'), 'application/javascript; charset=utf-8');
  assert.equal(scriptDirectRes.headers.get('access-control-allow-origin'), '*');
  const directCode = await scriptDirectRes.text();
  assert.ok(directCode.includes('SurfingKeys'));
});
