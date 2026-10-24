import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {JSDOM} from 'jsdom';
import AjvModule from 'ajv';
import {fixture, integrationAvailable} from './helpers.ts';
import {loadMetadataCatalog} from '../dist-tool/catalog.js';
import {resolveProfile} from '../dist-tool/profiles.js';
import {buildWithSelectives} from '../dist-tool/build.js';
import {refresh} from '../dist-tool/sources.js';
import {
  resolveSearchEngineItem,
  inferCanIframe
} from '../dist-tool/generation.js';

const Ajv = AjvModule.default;
const ajv = new Ajv({allErrors: true, strict: false});

test('aggregated-search: schema validation for searchGroups', async () => {
  const schemaPath = path.resolve('schemas/profile.schema.json');
  const schema = JSON.parse(await readFile(schemaPath, 'utf8'));
  const validate = ajv.compile(schema);

  // Valid profile with searchGroups
  const valid = {
    schemaVersion: 1,
    id: 'test-search-groups',
    searchGroups: [
      {
        id: 'dev',
        name: 'Developer Search',
        leader: 'ogd',
        mode: 'both',
        layout: 'auto',
        engines: [
          'upstream/search-engines.ddg',
          {
            name: 'DevDocs',
            url: 'https://devdocs.io/#q={query}',
            canIframe: true
          },
          {
            name: 'GitHub',
            url: 'https://github.com/search?q={query}',
            canIframe: false
          }
        ]
      }
    ]
  };
  assert.ok(validate(valid), JSON.stringify(validate.errors));

  // Invalid: missing required id or name or engines
  assert.equal(validate({schemaVersion: 1, id: 'bad', searchGroups: [{name: 'no-id'}]}), false);
  assert.equal(validate({schemaVersion: 1, id: 'bad', searchGroups: [{id: 'no-name', engines: ['ddg']}]}), false);
  assert.equal(validate({schemaVersion: 1, id: 'bad', searchGroups: [{id: 'no-engines', name: 'Name'}]}), false);
});

test('aggregated-search: profile inheritance and merging of searchGroups', async (t) => {
  const f = await fixture(true);
  t.after(f.cleanup);

  await f.write('profiles/common.json', {
    schemaVersion: 1,
    id: 'common',
    abstract: true,
    base: 'minimal',
    searchGroups: [
      {
        id: 'base_grp',
        name: 'Base Group',
        engines: ['ddg']
      },
      {
        id: 'override_me',
        name: 'Parent Version',
        engines: ['ddg']
      }
    ]
  });

  await f.write('profiles/personal.json', {
    schemaVersion: 1,
    id: 'personal',
    extends: 'common.json',
    searchGroups: [
      {
        id: 'override_me',
        name: 'Child Version',
        leader: 'ocm',
        engines: ['bing']
      },
      {
        id: 'child_grp',
        name: 'Child Group',
        engines: ['wikipedia']
      }
    ]
  });

  const catalog = await loadMetadataCatalog(f.ctx);
  const resolved = await resolveProfile(f.ctx, 'personal', catalog);

  assert.ok(resolved.searchGroups);
  assert.equal(resolved.searchGroups.length, 3);
  const base = resolved.searchGroups.find(g => g.id === 'base_grp')!;
  assert.equal(base.name, 'Base Group');

  const over = resolved.searchGroups.find(g => g.id === 'override_me')!;
  assert.equal(over.name, 'Child Version');
  assert.equal(over.leader, 'ocm');

  const child = resolved.searchGroups.find(g => g.id === 'child_grp')!;
  assert.equal(child.name, 'Child Group');
});

test('aggregated-search: engine resolution and canIframe inference', async (t) => {
  const f = await fixture(true);
  t.after(f.cleanup);
  const catalog = await loadMetadataCatalog(f.ctx);

  // Inferred canIframe
  assert.equal(inferCanIframe('https://www.bing.com/search?q={query}'), true);
  assert.equal(inferCanIframe('https://en.wikipedia.org/w/index.php?search={query}'), true);
  assert.equal(inferCanIframe('https://devdocs.io/#q={query}'), true);
  assert.equal(inferCanIframe('https://github.com/search?q={query}'), false);
  assert.equal(inferCanIframe('https://www.google.com/search?q={query}'), false);

  // resolveSearchEngineItem with catalog
  const ddg = resolveSearchEngineItem('upstream/search-engines.ddg', catalog);
  assert.equal(ddg.name, 'duckduckgo');
  assert.ok(ddg.url.includes('duckduckgo.com'));

  // resolveSearchEngineItem with standard aliases
  const bing = resolveSearchEngineItem('bing');
  assert.equal(bing.canIframe, true);
  assert.ok(bing.url.includes('bing.com'));

  const gh = resolveSearchEngineItem('github');
  assert.equal(gh.canIframe, false);

  // Custom object definition
  const custom = resolveSearchEngineItem({
    name: 'Custom',
    url: 'https://example.com/search?q={query}',
    canIframe: true
  });
  assert.equal(custom.name, 'Custom');
  assert.equal(custom.canIframe, true);
});

test('aggregated-search: end-to-end build and runtime execution trace', {skip: !integrationAvailable}, async (t) => {
  const f = await fixture(true);
  t.after(f.cleanup);

  await f.write('profiles/personal.json', {
    schemaVersion: 1,
    id: 'personal',
    selectAdd: ['upstream/search-engines.ddg'],
    searchGroups: [
      {
        id: 'dev',
        name: 'Developer Search',
        leader: 'ogd',
        mode: 'both',
        engines: [
          'upstream/search-engines.ddg',
          {
            name: 'DevDocs',
            url: 'https://devdocs.io/#q={query}',
            canIframe: true
          },
          {
            name: 'GitHub',
            url: 'https://github.com/search?q={query}&type=code',
            canIframe: false
          }
        ]
      },
      {
        id: 'web',
        name: 'Web Multi-Search',
        leader: 'ogw',
        mode: 'tabs',
        engines: [
          'bing',
          'duckduckgo'
        ]
      }
    ]
  });

  await refresh(f.ctx);
  const result = await buildWithSelectives({
    workspacePath: f.ctx.file,
    profileId: 'personal'
  });

  assert.ok(result.ok);
  assert.ok(result.scriptPath);

  const script = await readFile(result.scriptPath, 'utf8');

  // Verify registrations in generated bundle
  assert.ok(script.includes('_grp_dev'));
  assert.ok(script.includes('_grp_web'));
  assert.ok(script.includes('ogd'));
  assert.ok(script.includes('cogd'));
  assert.ok(script.includes('togd'));
  assert.ok(script.includes('ogw'));
  assert.ok(script.includes('cogw'));
  assert.ok(script.includes('togw'));

  // Execute in JSDOM environment
  const dom = new JSDOM('<!doctype html><html><body><div id="test">Hello World</div></body></html>', {
    url: 'https://example.com/',
    runScripts: 'outside-only'
  });
  t.after(() => dom.window.close());
  const w = dom.window as any;

  const calls: any[] = [];
  const settings = {};
  const api = {
    Front: {
      openOmnibar: (...args: any[]) => calls.push(['omni', ...args])
    },
    Clipboard: {
      read: (fn: any) => fn({data: 'clipboard-query'})
    },
    RUNTIME: (...args: any[]) => calls.push(['runtime', ...args]),
    mapkey: (...args: any[]) => calls.push(['mapkey', ...args]),
    addSearchAlias: (...args: any[]) => calls.push(['search', ...args])
  };
  w.api = api;
  w.settings = settings;

  // Execute generated bundle
  w.eval(script);

  // Check alias registrations
  const aliases = calls.filter(c => c[0] === 'search');
  assert.ok(aliases.some(a => a[1] === '_grp_dev'));
  assert.ok(aliases.some(a => a[1] === '_grp_web'));

  // Test mapkey execution: togd (batch open in tabs from clipboard)
  const togdBinding = calls.find(c => c[0] === 'mapkey' && c[1] === 'togd');
  assert.ok(togdBinding, 'togd mapping registered');
  togdBinding[3](); // Execute callback

  // Verify RUNTIME openLink calls were made for all 3 engines
  const runtimeCalls = calls.filter(c => c[0] === 'runtime' && c[1] === 'openLink');
  assert.equal(runtimeCalls.length, 3);
  assert.ok(runtimeCalls[0][2].url.includes('duckduckgo.com'));
  assert.equal(runtimeCalls[0][2].tab.active, true); // First tab active
  assert.ok(runtimeCalls[1][2].url.includes('devdocs.io'));
  assert.equal(runtimeCalls[1][2].tab.active, false); // Subsequent tabs in background
  assert.ok(runtimeCalls[2][2].url.includes('github.com'));
  assert.equal(runtimeCalls[2][2].tab.active, false);

  // Test mapkey execution: cogd (clipboard into Omnibar)
  const cogdBinding = calls.find(c => c[0] === 'mapkey' && c[1] === 'cogd');
  assert.ok(cogdBinding, 'cogd mapping registered');
  cogdBinding[3]();
  const omniCalls = calls.filter(c => c[0] === 'omni');
  assert.ok(omniCalls.some(o => o[1].extra === '_grp_dev' && o[1].pref === 'clipboard-query'));
});

test('aggregated-search: static Search Hub HTML layout and standalone integrity', async () => {
  const hubHtmlPath = path.resolve('ui/search-hub/index.html');
  const content = await readFile(hubHtmlPath, 'utf8');

  // Verify standalone nature: no localhost:9999 proxy endpoints
  assert.ok(!content.includes('/proxy?target='));
  assert.ok(!content.includes('http://127.0.0.1:9999'));

  // Verify responsive layout rules: grid for <= 4, tabs for > 4
  assert.ok(content.includes('grid-view count-'));
  assert.ok(content.includes('count <= 4'));
  assert.ok(content.includes('tabs-view'));

  // Verify smart fallback card for blocked sites
  assert.ok(content.includes('fallback-card'));
  assert.ok(content.includes('canIframe'));
  assert.ok(content.includes('在新标签页打开'));

  // Verify DOM structure with JSDOM
  const dom = new JSDOM(content, {url: 'http://localhost/', runScripts: 'dangerously'});
  const doc = dom.window.document;

  assert.ok(doc.querySelector('#group-select'), 'Group select exists');
  assert.ok(doc.querySelector('#query-input'), 'Query input exists');
  assert.ok(doc.querySelector('#content-container'), 'Content container exists');
  assert.ok(doc.querySelector('#btn-open-all'), 'Open all button exists');
  assert.ok(doc.querySelector('#auto-open-toggle'), 'Auto open toggle exists');
});
