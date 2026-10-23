import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile, stat, rm} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import Ajv from 'ajv';

const exec = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

test('wave4: root skills directory contains npx skills compatible definitions and references', async () => {
  for (const skill of ['surfingkeys-profile-create', 'surfingkeys-profile-update']) {
    const skillPath = path.resolve(projectRoot, `skills/${skill}/SKILL.md`);
    const content = await readFile(skillPath, 'utf8');
    assert.ok(content.startsWith('---'));
    assert.ok(content.includes(`name: ${skill}`));

    const refPath = path.resolve(projectRoot, `skills/${skill}/references/v2-schema.md`);
    const refContent = await readFile(refPath, 'utf8');
    assert.ok(refContent.includes('"schemaVersion": 2'));
    assert.ok(refContent.includes('@skcb/lib-b0o'));
  }
});

test('wave4: templates are standalone, valid and free of workspace:* protocols', async () => {
  const schemasDir = path.resolve(projectRoot, 'packages/core/schemas');
  const wsSchema = JSON.parse(await readFile(path.join(schemasDir, 'workspace.schema.json'), 'utf8'));
  const profileSchema = JSON.parse(await readFile(path.join(schemasDir, 'profile.schema.json'), 'utf8'));
  const manifestSchema = JSON.parse(await readFile(path.join(schemasDir, 'manifest.schema.json'), 'utf8'));

  const ajv = new Ajv({allErrors: true});
  const validateWs = ajv.compile(wsSchema);
  const validateProfile = ajv.compile(profileSchema);
  const validateManifest = ajv.compile(manifestSchema);

  // 1. skcb-proj-repo
  const projDir = path.resolve(projectRoot, 'templates/skcb-proj-repo');
  const projPkg = JSON.parse(await readFile(path.join(projDir, 'package.json'), 'utf8'));
  assert.ok(!JSON.stringify(projPkg).includes('workspace:*'));

  const projWs = JSON.parse(await readFile(path.join(projDir, 'surfingkeys.workspace.json'), 'utf8'));
  assert.equal(validateWs(projWs), true, JSON.stringify(validateWs.errors));

  for (const p of ['common.json', 'personal.json', 'work.json']) {
    const pData = JSON.parse(await readFile(path.join(projDir, 'profiles', p), 'utf8'));
    assert.equal(validateProfile(pData), true, JSON.stringify(validateProfile.errors));
  }

  const projExt = JSON.parse(await readFile(path.join(projDir, 'extensions/custom/selective.json'), 'utf8'));
  assert.equal(validateManifest(projExt), true, JSON.stringify(validateManifest.errors));

  // 2. skcb-lib-repo
  const libDir = path.resolve(projectRoot, 'templates/skcb-lib-repo');
  const libPkg = JSON.parse(await readFile(path.join(libDir, 'package.json'), 'utf8'));
  assert.ok(!JSON.stringify(libPkg).includes('workspace:*'));

  const libExt = JSON.parse(await readFile(path.join(libDir, 'selective.json'), 'utf8'));
  assert.equal(validateManifest(libExt), true, JSON.stringify(validateManifest.errors));
});

test('wave4: scripts/init.sh is executable and supports dry-run and automated project creation', async t => {
  const initScript = path.resolve(projectRoot, 'scripts/init.sh');
  const st = await stat(initScript);
  assert.ok((st.mode & 0o111) !== 0, 'scripts/init.sh must be executable');

  // 1. Help flag
  const helpRes = await exec(initScript, ['--help']);
  assert.ok(helpRes.stdout.includes('SurfingKeys Config Builder (skcb) Project Initializer'));

  // 2. Dry run flag
  const dryRes = await exec(initScript, ['--dry-run', '--yes']);
  assert.ok(dryRes.stdout.includes('[DRY RUN]'));

  // 3. Automated creation in test directory
  const testDir = path.resolve(projectRoot, '.cache/test-init-automated');
  t.after(() => rm(testDir, {recursive: true, force: true}));

  const initRes = await exec(initScript, ['--yes', '--dir', testDir, '--libs', 'b0o,ent', '--no-ui']);
  assert.ok(initRes.stdout.includes('Successfully initialized skcb project'));

  const createdWs = JSON.parse(await readFile(path.join(testDir, 'surfingkeys.workspace.json'), 'utf8'));
  assert.equal(createdWs.schemaVersion, 2);
  assert.ok(createdWs.libraries.includes('@skcb/lib-b0o'));
  assert.ok(createdWs.libraries.includes('@skcb/lib-ent'));
  assert.ok(!createdWs.libraries.includes('@skcb/lib-tech'));
});

test('wave4: documentation includes monorepo architecture and modules reference', async () => {
  const archDoc = await readFile(path.resolve(projectRoot, 'docs/monorepo-architecture.md'), 'utf8');
  assert.ok(archDoc.includes('@skcb/core'));
  assert.ok(archDoc.includes('@skcb/ui'));
  assert.ok(archDoc.includes('Monorepo'));

  const modDoc = await readFile(path.resolve(projectRoot, 'docs/modules.md'), 'utf8');
  assert.ok(modDoc.includes('@skcb/lib-b0o'));
  assert.ok(modDoc.includes('@skcb/lib-ent'));
  assert.ok(modDoc.includes('@skcb/lib-tech'));
  assert.ok(modDoc.includes('@skcb/lib-prod'));
  assert.ok(modDoc.includes('defineSite'));
});
