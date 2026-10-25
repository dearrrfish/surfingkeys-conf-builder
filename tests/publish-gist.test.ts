import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  findBuiltProfiles,
  generateGistReadme,
  buildGistPayload,
  publishToGist,
  main
} from '../templates/skcb-proj-repo/scripts/publish-gist.mjs';

const exec = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

test('publish-gist: generateGistReadme formats valid markdown with profile links and visibility', () => {
  const profiles = [
    { id: 'personal', content: 'console.log("personal");' },
    { id: 'work', content: 'console.log("work");' }
  ];

  // 1. Public visibility
  const readmePub = generateGistReadme({
    repoName: 'user/my-skcb-config',
    profiles,
    gistId: 'abcd1234efgh5678',
    owner: 'user',
    isPublic: true
  });

  assert.ok(readmePub.includes('SurfingKeys Profiles'));
  assert.ok(readmePub.includes('user/my-skcb-config'));
  assert.ok(readmePub.includes('Public'));
  assert.ok(readmePub.includes('https://gist.githubusercontent.com/user/abcd1234efgh5678/raw/personal.js'));
  assert.ok(readmePub.includes('https://gist.githubusercontent.com/user/abcd1234efgh5678/raw/work.js'));

  // 2. Secret (private) visibility
  const readmePriv = generateGistReadme({
    repoName: 'user/my-skcb-config',
    profiles,
    gistId: 'abcd1234efgh5678',
    owner: 'user',
    isPublic: false
  });

  assert.ok(readmePriv.includes('Secret (Private)'));
});

test('publish-gist: buildGistPayload creates single Gist structure with all profiles', () => {
  const profiles = [
    { id: 'personal', content: '// Personal profile bundle' },
    { id: 'work', content: '// Work profile bundle' },
    { id: 'custom-dev', content: '// Dev profile bundle' }
  ];

  const payload = buildGistPayload({
    profiles,
    readme: '# My Gist',
    description: 'SurfingKeys Config Profiles (user/repo)',
    isPublic: true
  });

  assert.equal(payload.description, 'SurfingKeys Config Profiles (user/repo)');
  assert.equal(payload.public, true);
  // All profiles must exist in the same payload files map
  assert.deepEqual(Object.keys(payload.files).sort(), ['README.md', 'custom-dev.js', 'personal.js', 'work.js']);
  assert.equal(payload.files['personal.js'].content, '// Personal profile bundle');
  assert.equal(payload.files['work.js'].content, '// Work profile bundle');
  assert.equal(payload.files['custom-dev.js'].content, '// Dev profile bundle');
  assert.equal(payload.files['README.md'].content, '# My Gist');

  // Secret / private configuration
  const secretPayload = buildGistPayload({
    profiles,
    readme: '',
    description: 'Private Profiles',
    isPublic: false
  });
  assert.equal(secretPayload.public, false);
});

test('publish-gist: findBuiltProfiles discovers profiles from current.json and direct dist files', async t => {
  const testWsDir = path.resolve(projectRoot, '.cache/test-publish-discovery');
  await rm(testWsDir, { recursive: true, force: true });
  t.after(() => rm(testWsDir, { recursive: true, force: true }));

  await mkdir(path.join(testWsDir, 'profiles'), { recursive: true });
  await mkdir(path.join(testWsDir, 'dist/personal/builds/bld-1'), { recursive: true });
  await mkdir(path.join(testWsDir, 'dist/work'), { recursive: true });

  // Workspace config
  await writeFile(
    path.join(testWsDir, 'surfingkeys.workspace.json'),
    JSON.stringify({ schemaVersion: 2, profilesDir: 'profiles', outDir: 'dist' })
  );

  // Profile configs: common (abstract), personal, work
  await writeFile(
    path.join(testWsDir, 'profiles/common.json'),
    JSON.stringify({ id: 'common', abstract: true })
  );
  await writeFile(
    path.join(testWsDir, 'profiles/personal.json'),
    JSON.stringify({ id: 'personal' })
  );
  await writeFile(
    path.join(testWsDir, 'profiles/work.json'),
    JSON.stringify({ id: 'work' })
  );

  // Dist artifacts: personal uses current.json, work uses direct surfingkeys.js
  await writeFile(
    path.join(testWsDir, 'dist/personal/builds/bld-1/surfingkeys.js'),
    'console.log("personal bundled script");'
  );
  await writeFile(
    path.join(testWsDir, 'dist/personal/current.json'),
    JSON.stringify({
      schemaVersion: 1,
      profileId: 'personal',
      buildId: 'bld-1',
      artifacts: { script: 'builds/bld-1/surfingkeys.js' }
    })
  );

  await writeFile(
    path.join(testWsDir, 'dist/work/surfingkeys.js'),
    'console.log("work standard script");'
  );

  const result = await findBuiltProfiles(testWsDir);
  assert.equal(result.profiles.length, 2);

  const personal = result.profiles.find(p => p.id === 'personal');
  assert.ok(personal);
  assert.equal(personal.content, 'console.log("personal bundled script");');
  assert.equal(personal.buildId, 'bld-1');

  const work = result.profiles.find(p => p.id === 'work');
  assert.ok(work);
  assert.equal(work.content, 'console.log("work standard script");');

  // common (abstract) must not be included
  assert.ok(!result.profiles.some(p => p.id === 'common'));
});

test('publish-gist: publishToGist handles dry-run mode without token or network calls', async () => {
  const result = await publishToGist({
    token: '',
    gistId: 'test-gist-123',
    description: 'Test Gist',
    isPublic: true,
    files: { 'personal.js': { content: 'test' } },
    dryRun: true
  });

  assert.equal(result.success, true);
  assert.equal(result.dryRun, true);
  assert.equal(result.gistId, 'test-gist-123');
  assert.equal(result.isPublic, true);
  assert.deepEqual(result.files, ['personal.js']);
});

test('publish-gist: publishToGist throws clear error when token is missing in live mode', async () => {
  await assert.rejects(
    async () => {
      await publishToGist({
        token: '',
        files: { 'personal.js': { content: 'test' } },
        dryRun: false
      });
    },
    /GitHub Token is missing[\s\S]*gist[\s\S]*scope/
  );
});

test('publish-gist: publishToGist updates existing Gist via PATCH when gistId is provided', async () => {
  const mockCalls: { url: string; method: string; body: any; headers: any }[] = [];

  const mockFetch = async (url: string, options: any) => {
    mockCalls.push({
      url,
      method: options.method,
      body: JSON.parse(options.body),
      headers: options.headers
    });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        id: 'target-gist-id',
        html_url: 'https://gist.github.com/mockuser/target-gist-id',
        public: true,
        owner: { login: 'mockuser' },
        files: {
          'personal.js': { filename: 'personal.js' },
          'work.js': { filename: 'work.js' }
        }
      })
    };
  };

  const result = await publishToGist({
    token: 'mock-pat-token',
    gistId: 'target-gist-id',
    description: 'Updated Description',
    isPublic: true,
    files: {
      'personal.js': { content: 'p content' },
      'work.js': { content: 'w content' }
    },
    fetchFn: mockFetch as any
  });

  assert.equal(result.success, true);
  assert.equal(result.updated, true);
  assert.equal(result.gistId, 'target-gist-id');
  assert.equal(mockCalls.length, 1);
  assert.equal(mockCalls[0].url, 'https://api.github.com/gists/target-gist-id');
  assert.equal(mockCalls[0].method, 'PATCH');
  assert.equal(mockCalls[0].headers['Authorization'], 'Bearer mock-pat-token');
  assert.equal(mockCalls[0].body.description, 'Updated Description');
  assert.equal(mockCalls[0].body.files['personal.js'].content, 'p content');
  assert.equal(mockCalls[0].body.files['work.js'].content, 'w content');
});

test('publish-gist: publishToGist creates new Gist via POST when no matching gist exists', async () => {
  const mockCalls: { url: string; method: string; body?: any }[] = [];

  const mockFetch = async (url: string, options: any) => {
    mockCalls.push({
      url,
      method: options.method,
      body: options.body ? JSON.parse(options.body) : undefined
    });

    if (options.method === 'GET') {
      // List gists returns none matching
      return {
        ok: true,
        status: 200,
        json: async () => [
          { id: 'other-gist', description: 'Unrelated Gist' }
        ]
      };
    }

    if (options.method === 'POST') {
      return {
        ok: true,
        status: 201,
        json: async () => ({
          id: 'newly-created-gist-id',
          html_url: 'https://gist.github.com/mockuser/newly-created-gist-id',
          public: false,
          owner: { login: 'mockuser' },
          files: options.body ? JSON.parse(options.body).files : {}
        })
      };
    }

    throw new Error(`Unexpected call: ${options.method} ${url}`);
  };

  const result = await publishToGist({
    token: 'mock-pat-token',
    gistId: '',
    description: 'SurfingKeys Config Profiles (my-repo)',
    isPublic: false, // Secret Gist
    files: {
      'personal.js': { content: 'secret personal script' }
    },
    fetchFn: mockFetch as any
  });

  assert.equal(result.success, true);
  assert.equal(result.created, true);
  assert.equal(result.gistId, 'newly-created-gist-id');
  assert.equal(result.isPublic, false);

  assert.equal(mockCalls.length, 2);
  assert.equal(mockCalls[0].method, 'GET');
  assert.equal(mockCalls[1].method, 'POST');
  assert.equal(mockCalls[1].body.public, false);
  assert.equal(mockCalls[1].body.description, 'SurfingKeys Config Profiles (my-repo)');
});

test('publish-gist: template publish-gist.yml workflow is valid and disabled by default', async () => {
  const workflowPath = path.resolve(projectRoot, 'templates/skcb-proj-repo/.github/workflows/publish-gist.yml');
  const content = await readFile(workflowPath, 'utf8');

  // Verify triggers
  assert.ok(content.includes('push:'));
  assert.ok(content.includes('profiles/**'));
  assert.ok(content.includes('workflow_dispatch:'));

  // Verify disabled by default
  assert.ok(content.includes("ENABLED: 'false'"));
  assert.ok(content.includes("vars.GIST_PUBLISH_ENABLED == 'true' || env.ENABLED == 'true'"));

  // Verify public / secret configuration with public default
  assert.ok(content.includes("vars.GIST_PUBLIC"));
  assert.ok(content.includes("default: 'public'"));

  // Verify build and publish steps
  assert.ok(content.includes('npm run build'));
  assert.ok(content.includes('node scripts/publish-gist.mjs'));
  assert.ok(content.includes('secrets.GIST_TOKEN'));
});

test('publish-gist: scripts/init.sh supports --no-gist-action to exclude publishing workflow', async t => {
  const initScript = path.resolve(projectRoot, 'scripts/init.sh');
  const testDir = path.resolve(projectRoot, '.cache/test-init-no-gist');
  await rm(testDir, { recursive: true, force: true });
  t.after(() => rm(testDir, { recursive: true, force: true }));

  const res = await exec(initScript, ['--yes', '--dir', testDir, '--no-gist-action']);
  assert.ok(res.stdout.includes('Successfully initialized skcb project'));

  // With --no-gist-action, publish-gist workflow must NOT exist
  let fileExists = false;
  try {
    await readFile(path.join(testDir, '.github/workflows/publish-gist.yml'));
    fileExists = true;
  } catch {
    fileExists = false;
  }
  assert.equal(fileExists, false, 'publish-gist.yml should not be present when --no-gist-action is used');
});

test('publish-gist: scripts/init.sh includes gist publishing workflow by default', async t => {
  const initScript = path.resolve(projectRoot, 'scripts/init.sh');
  const testDir = path.resolve(projectRoot, '.cache/test-init-default-gist');
  await rm(testDir, { recursive: true, force: true });
  t.after(() => rm(testDir, { recursive: true, force: true }));

  const res = await exec(initScript, ['--yes', '--dir', testDir]);
  assert.ok(res.stdout.includes('Successfully initialized skcb project'));

  // By default, publish-gist workflow and script MUST exist
  const workflowContent = await readFile(path.join(testDir, '.github/workflows/publish-gist.yml'), 'utf8');
  assert.ok(workflowContent.includes('Publish Profiles to GitHub Gist'));

  const scriptContent = await readFile(path.join(testDir, 'scripts/publish-gist.mjs'), 'utf8');
  assert.ok(scriptContent.includes('findBuiltProfiles'));

  const pkg = JSON.parse(await readFile(path.join(testDir, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['publish:gist'], 'node scripts/publish-gist.mjs');
});

test('publish-gist: main CLI execution handles help, missing profiles, dry-run, and missing token', async t => {
  const testWsDir = path.resolve(projectRoot, '.cache/test-publish-cli');
  await rm(testWsDir, { recursive: true, force: true });
  t.after(() => rm(testWsDir, { recursive: true, force: true }));

  // 1. --help flag returns 0
  const helpCode = await main(['--help']);
  assert.equal(helpCode, 0);

  // 2. Empty directory returns 1 (no built profiles found)
  await mkdir(path.join(testWsDir, 'empty'), { recursive: true });
  const noProfilesCode = await main(['--workspace', path.join(testWsDir, 'empty')]);
  assert.equal(noProfilesCode, 1);

  // 3. Directory with built profile:
  const wsWithProfile = path.join(testWsDir, 'ws');
  await mkdir(path.join(wsWithProfile, 'profiles'), { recursive: true });
  await mkdir(path.join(wsWithProfile, 'dist/personal'), { recursive: true });
  await writeFile(
    path.join(wsWithProfile, 'profiles/personal.json'),
    JSON.stringify({ id: 'personal' })
  );
  await writeFile(
    path.join(wsWithProfile, 'dist/personal/surfingkeys.js'),
    'console.log("personal script");'
  );

  // Missing token in non-dry-run mode returns 1
  const missingTokenCode = await main(['--workspace', wsWithProfile], {
    DRY_RUN: 'false',
    GIST_TOKEN: '',
    GITHUB_TOKEN: ''
  });
  assert.equal(missingTokenCode, 1);

  // Dry-run mode returns 0
  const dryRunCode = await main(['--dry-run', '--workspace', wsWithProfile, '--public', 'true'], {});
  assert.equal(dryRunCode, 0);

  // Secret / private dry-run mode returns 0
  const secretDryRunCode = await main(['--dry-run', '--workspace', wsWithProfile, '--secret'], {});
  assert.equal(secretDryRunCode, 0);
});

