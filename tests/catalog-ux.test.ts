import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM, VirtualConsole} from 'jsdom';

async function loadUI(t) {
  const errors = [];
  const console = new VirtualConsole();
  console.on('jsdomError', error => errors.push(error));
  const html = await readFile(new URL('../packages/ui/ui/index.html', import.meta.url), 'utf8');
  const dom = new JSDOM(html, {runScripts: 'dangerously', url: 'file:///builder.html', virtualConsole: console});
  await new Promise(resolve => dom.window.addEventListener('load', resolve, {once: true}));
  t.after(() => { dom.window.close(); assert.deepEqual(errors, []); });
  const w = dom.window;
  return {w, doc: w.document, state: w.eval('state'), catalog: w.eval('CATALOG')};
}

const key = (kind, lib, domain = '') => encodeURIComponent(JSON.stringify([kind, lib, domain]));
const group = (doc, value) => [...doc.querySelectorAll('details[data-group-key]')].find(el => el.dataset.groupKey === value);
const tick = () => new Promise(resolve => setTimeout(resolve, 10));

test('目录折叠跨重渲染保留，层级与平铺站点状态独立', async t => {
  const {w, doc} = await loadUI(t);
  const libKey = key('lib', 'tech');
  const domainKey = key('domain', 'tech', 'github.com');
  group(doc, domainKey).open = false;
  await tick();
  group(doc, libKey).open = false;
  await tick();
  w.renderCatalog();
  assert.equal(group(doc, libKey).open, false);
  assert.equal(group(doc, domainKey).open, false);
  doc.getElementById('btn-view-flat').click();
  assert.equal(doc.querySelectorAll('.catalog-group-lib-header').length, 0);
  assert.equal(group(doc, key('domain', '*', 'github.com')).open, true);
  doc.getElementById('btn-view-hierarchy').click();
  assert.equal(group(doc, libKey).open, false);
  doc.getElementById('btn-expand-all').click();
  assert.ok([...doc.querySelectorAll('details')].every(el => el.open));
  doc.getElementById('btn-collapse-all').click();
  assert.ok([...doc.querySelectorAll('details')].every(el => !el.open));
});

test('禁用 lib 与站点收纳为 tile，批量操作遵守继承并保留单键定制', async t => {
  const {w, doc, state, catalog} = await loadUI(t);
  const removed = [...state.profile.selectRemoveContributions];
  const b0o = key('lib', 'b0o');
  w.toggleCatalogGroup(b0o, false);
  assert.equal(group(doc, b0o), undefined);
  assert.ok(state.profile.selectRemove.includes('b0o/search-engines.ddg'));
  const tile = [...doc.querySelectorAll('.catalog-disabled .catalog-tile')].find(el => el.textContent.includes('@skcb/lib-b0o'));
  assert.ok(tile);
  tile.click();
  assert.ok(group(doc, b0o));
  assert.ok(!state.profile.selectRemove.includes('b0o/search-engines.ddg'));
  assert.ok(!state.profile.selectAdd.includes('b0o/search-engines.ddg'));
  assert.ok(catalog.filter(f => f.lib === 'b0o').every(f => w.getEffectiveFeatureIds().has(f.id)));
  const site = key('domain', 'tech', 'github.com');
  w.toggleCatalogGroup(site, false);
  assert.equal(group(doc, site), undefined);
  assert.ok([...doc.querySelectorAll('.catalog-disabled .catalog-tile')].some(el => el.textContent.includes('github.com')));
  w.toggleCatalogGroup(site, true);
  assert.ok(group(doc, site));
  assert.deepEqual([...state.profile.selectRemoveContributions], removed);
  doc.getElementById('btn-view-flat').click();
  const flatSite = key('domain', '*', 'github.com');
  w.toggleCatalogGroup(flatSite, false);
  assert.equal(group(doc, flatSite), undefined);
  assert.ok(catalog.filter(f => f.domain === 'github.com').every(f => !w.getEffectiveFeatureIds().has(f.id)));
  w.toggleCatalogGroup(flatSite, true);
  assert.ok(group(doc, flatSite));
});

test('简易模式只呈现启停 tile，切换不修改 profile，筛选不缩小组操作范围', async t => {
  const {w, doc, state, catalog} = await loadUI(t);
  const before = JSON.stringify(state.profile);
  doc.getElementById('btn-simple-mode').click();
  assert.equal(doc.getElementById('btn-simple-mode').getAttribute('aria-pressed'), 'true');
  assert.equal(doc.querySelectorAll('#catalog-cards-list .feature-card, #catalog-cards-list .contrib-drawer').length, 0);
  assert.equal(JSON.stringify(state.profile), before);
  const tile = [...doc.querySelectorAll('.catalog-tile')].find(el => el.textContent.includes('tech/actions.github'));
  tile.click();
  assert.ok(!w.getEffectiveFeatureIds().has('tech/actions.github'));
  doc.getElementById('btn-simple-mode').click();
  assert.ok(doc.querySelector('#catalog-cards-list .feature-card'));
  state.searchQuery = 'github';
  w.renderCatalog();
  w.toggleCatalogGroup(key('lib', 'tech'), false);
  assert.ok(catalog.filter(f => f.lib === 'tech').every(f => !w.getEffectiveFeatureIds().has(f.id)));
  w.toggleCatalogGroup(key('lib', 'tech'), true);
  assert.ok(catalog.filter(f => f.lib === 'tech').every(f => w.getEffectiveFeatureIds().has(f.id)));
  doc.getElementById('btn-lang-toggle').click();
  assert.equal(doc.getElementById('btn-simple-mode').textContent, 'Simple Mode');
});

test('第三方 lib 自动纳入优先级且排序影响冲突胜出项，预设恢复保存的顺序', async t => {
  const {w, doc, state, catalog} = await loadUI(t);
  catalog.push({id: 'bb/actions.github', lib: 'bb', pkg: '@skcb/lib-bb', category: 'actions', domain: 'github.com', desc: {'zh-CN': '第三方 GitHub'}, contributions: [{id: 'actions', kind: 'mapkey', alias: 'A', domain: 'github.com', desc: {'zh-CN': '第三方动作'}}]});
  state.profile.selectAdd.push('bb/actions.github');
  w.renderAll();
  assert.ok(doc.getElementById('precedence-pills').textContent.includes('bb'));
  assert.equal(state.profile.conflictResolution.modulePrecedence.filter(lib => lib === 'bb').length, 1);
  while (state.profile.conflictResolution.modulePrecedence.indexOf('bb') > 0) {
    const pills = [...doc.querySelectorAll('.precedence-pill')];
    pills[state.profile.conflictResolution.modulePrecedence.indexOf('bb')].querySelector('button').click();
  }
  assert.ok(w.computeResolution().activeContribs.some(c => c.fullId === 'bb/actions.github#actions'));
  assert.ok(JSON.parse(doc.getElementById('live-profile-json').textContent).conflictResolution.modulePrecedence.includes('bb'));
  w.eval('PRESETS.work.modulePrecedence = ["bb", "tech"]');
  const switcher = doc.getElementById('preset-profile-switcher');
  switcher.value = 'work';
  switcher.dispatchEvent(new w.Event('change'));
  assert.deepEqual([...state.profile.conflictResolution.modulePrecedence].slice(0, 2), ['bb', 'tech']);
});

test('禁用 tile 和分组禁用使用统一 switch 且均可点击', async t => {
  const {w, doc} = await loadUI(t);
  w.toggleCatalogGroup(key('lib', 'prod'), true);
  w.toggleCatalogGroup(key('domain', 'prod', 'mail.google.com'), false);
  const tile = [...doc.querySelectorAll('.catalog-disabled .catalog-tile')].find(el => el.textContent === 'mail.google.com');
  assert.ok(tile);
  assert.equal(tile.getAttribute('role'), 'switch');
  assert.equal(tile.getAttribute('aria-checked'), 'false');
  tile.click();
  const site = group(doc, key('domain', 'prod', 'mail.google.com'));
  const toggle = site.querySelector('.catalog-group-toolbar [role="switch"]');
  assert.equal(toggle.getAttribute('aria-checked'), 'true');
  assert.equal(toggle.textContent, '');
  toggle.click();
  assert.equal(group(doc, key('domain', 'prod', 'mail.google.com')), undefined);
});
