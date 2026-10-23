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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

test('wave3: all native libraries selective.json satisfy manifest schema', async () => {
  const manifestSchemaPath = path.resolve(projectRoot, 'packages/core/schemas/manifest.schema.json');
  const manifestSchema = JSON.parse(await readFile(manifestSchemaPath, 'utf8'));

  const ajv = new Ajv({allErrors: true});
  const validator = ajv.compile(manifestSchema);

  for (const lib of ['lib-ent', 'lib-tech', 'lib-prod']) {
    const selectivePath = path.resolve(projectRoot, `packages/${lib}/dist/selective.json`);
    const selective = JSON.parse(await readFile(selectivePath, 'utf8'));
    const valid = validator(selective);
    assert.equal(valid, true, `Schema validation failed for ${lib}: ` + JSON.stringify(validator.errors, null, 2));
  }
});

test('wave3: @skcb/lib-ent fixes bilibili quote bug, lazy youtube evaluation and twitter nitter', async () => {
  const entDir = path.resolve(projectRoot, 'packages/lib-ent/dist');

  // 1. Bilibili clean selector (no trailing quote)
  const bilibiliJs = await readFile(path.join(entDir, 'actions/bilibili.js'), 'utf8');
  assert.ok(!bilibiliJs.includes('.bpx-player-ctrl-full"'));
  assert.ok(bilibiliJs.includes('.bpx-player-ctrl-full'));

  // 2. YouTube does not eagerly evaluate URL on module import
  const youtubeJs = await readFile(path.join(entDir, 'actions/youtube.js'), 'utf8');
  assert.ok(youtubeJs.includes('piped.video'));
  assert.ok(youtubeJs.includes('open-piped'));

  // 3. Twitter Nitter integration
  const twitterJs = await readFile(path.join(entDir, 'actions/twitter.js'), 'utf8');
  assert.ok(twitterJs.includes('nitter.net'));
});

test('wave3: @skcb/lib-tech fixes clipboard open bug, sspai aliases and repo parser', async () => {
  const techDir = path.resolve(projectRoot, 'packages/lib-tech/dist');

  // 1. GitHub action executes clipboard properly
  const githubJs = await readFile(path.join(techDir, 'actions/github.js'), 'utf8');
  assert.ok(githubJs.includes('open-from-clipboard'));

  // 2. sspai search engine aliases
  const selective = JSON.parse(await readFile(path.join(techDir, 'selective.json'), 'utf8'));
  const sspaiContribs = selective.entries['search-engines.sspai'].contributions;
  assert.ok(sspaiContribs.some((c: any) => c.id === 'article' && c.alias === 'ssp'));
  assert.ok(sspaiContribs.some((c: any) => c.id === 'tag' && c.alias === 'sspt'));

  // 3. parseGithubRepo helper
  const {parseGithubRepo} = await import('../packages/lib-tech/dist/index.js');
  const repo = parseGithubRepo('https://github.com/torvalds/linux/pulls');
  assert.deepEqual(repo, {
    owner: 'torvalds',
    repo: 'linux',
    repoBase: 'https://github.com/torvalds/linux'
  });
  assert.equal(parseGithubRepo('https://other.com/foo/bar'), null);
});

test('wave3: @skcb/lib-prod fixes gmail domain/path split, gC bug, selector bracket and pinboard', async () => {
  const prodDir = path.resolve(projectRoot, 'packages/lib-prod/dist');

  // 1. Gmail selective definition separates domain and path
  const selective = JSON.parse(await readFile(path.join(prodDir, 'selective.json'), 'utf8'));
  const gmail = selective.entries['actions.gmail'];
  assert.equal(gmail.contributions[0].domain, 'mail.google.com');
  assert.ok(gmail.contributions[0].path);

  // 2. Gmail gC goes to CONTACTS and selector has closing bracket
  const gmailJs = await readFile(path.join(prodDir, 'actions/gmail.js'), 'utf8');
  assert.ok(gmailJs.includes('select[name="tact"]'));
  assert.ok(gmailJs.includes("'go-to-contacts': () => goTo('CONTACTS')"));

  // 3. Pinboard search engines use pb and pbt
  const pinboardSearch = selective.entries['search-engines.pinboard'];
  assert.ok(pinboardSearch.contributions.some((c: any) => c.id === 'search' && c.alias === 'pb'));
  assert.ok(pinboardSearch.contributions.some((c: any) => c.id === 'tag' && c.alias === 'pbt'));
});

test('wave3: consumer workspace resolves multi-module composition across ent, tech and prod', async t => {
  const f = await fixture();
  t.after(f.cleanup);

  const entDir = path.resolve(projectRoot, 'packages/lib-ent/dist');
  const techDir = path.resolve(projectRoot, 'packages/lib-tech/dist');
  const prodDir = path.resolve(projectRoot, 'packages/lib-prod/dist');

  // Configure workspace with all 3 native libraries
  await f.write('surfingkeys.workspace.json', {
    schemaVersion: 2,
    libraries: [entDir, techDir, prodDir],
    profilesDir: 'profiles',
    outDir: 'dist'
  });

  const ctx = await workspace(f.ctx.file);
  const catalog = await loadMetadataCatalog(ctx);

  // Check that all namespaces are loaded
  assert.ok(catalog.entries.some(e => e.id.startsWith('ent/')));
  assert.ok(catalog.entries.some(e => e.id.startsWith('tech/')));
  assert.ok(catalog.entries.some(e => e.id.startsWith('prod/')));

  // Profile selecting entries from each library
  await f.write('profiles/personal.json', {
    schemaVersion: 2,
    id: 'personal',
    selectAdd: [
      'ent/actions.bilibili',
      'ent/search-engines.bilibili',
      'tech/actions.github',
      'tech/search-engines.sspai',
      'prod/actions.gmail',
      'prod/search-engines.pinboard'
    ]
  });

  const profile = await resolveProfile(ctx, 'personal', catalog);
  const expl: any = explain(profile, catalog);

  assert.equal(expl.requested.length, 6);
  assert.ok(expl.contributions.length > 15);
  assert.ok(expl.contributions.some((c: any) => c.id.startsWith('ent/actions.bilibili#')));
  assert.ok(expl.contributions.some((c: any) => c.id.startsWith('tech/actions.github#')));
  assert.ok(expl.contributions.some((c: any) => c.id.startsWith('prod/actions.gmail#')));
});
