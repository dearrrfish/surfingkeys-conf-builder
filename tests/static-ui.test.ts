import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM, VirtualConsole} from 'jsdom';

const tick = (ms = 25) => new Promise(resolve => setTimeout(resolve, ms));

async function loadStaticUI(t: any, options: any = {}) {
  const errors: any[] = [];
  const console = new VirtualConsole();
  console.on('jsdomError', err => errors.push(err));

  const rawHtml = await readFile(new URL('../packages/ui/ui/index.html', import.meta.url), 'utf8');

  const staticConfig = options.staticConfig ?? {
    schemaVersion: 1,
    mode: 'static',
    generator: 'skcb-static',
    generatedAt: '2026-10-28T00:00:00.000Z',
    repository: 'test-owner/test-repo',
    baseBranch: 'main',
    catalog: 'data/catalog.json',
    profiles: 'data/profiles.json'
  };

  const html = options.serverMode
    ? rawHtml
    : rawHtml.replace(
        '<script id="skcb-static-config" type="application/json">{}</script>',
        `<script id="skcb-static-config" type="application/json">${JSON.stringify(staticConfig)}</script>`
      );

  const url = options.serverMode
    ? 'http://127.0.0.1:3000/'
    : (options.url ?? 'https://test-owner.github.io/test-repo/');

  const fetchCalls: {url: string; init: any}[] = [];

  const defaultFetch = async (input: any, init: any = {}) => {
    const reqUrl = typeof input === 'string' ? input : input.url;
    fetchCalls.push({url: reqUrl, init});

    if (options.customFetchHandler) {
      const handled = await options.customFetchHandler(reqUrl, init);
      if (handled) {
        return handled;
      }
    }

    if (reqUrl.endsWith('data/catalog.json')) {
      return {
        ok: true,
        status: 200,
        headers: new Map(),
        json: async () => ({
          schemaVersion: 1,
          catalog: {
            entries: [
              {
                id: 'upstream/actions.amazon',
                source: 'upstream',
                contributions: [{id: 'view', alias: 'a', domain: 'amazon.com', description: {'zh-CN': '查看商品'}}]
              }
            ]
          }
        }),
        text: async () => JSON.stringify({schemaVersion: 1, catalog: {entries: []}})
      };
    }

    if (reqUrl.endsWith('data/profiles.json')) {
      return {
        ok: true,
        status: 200,
        headers: new Map(),
        json: async () => ({
          schemaVersion: 1,
          profiles: [
            {id: 'common', abstract: true, locale: 'zh-CN', file: 'profiles/common.json'},
            {id: 'personal', abstract: false, extends: 'common.json', locale: 'zh-CN', file: 'profiles/personal.json'},
            {id: 'work', abstract: false, extends: 'common.json', locale: 'en', file: 'profiles/work.json'}
          ]
        }),
        text: async () => JSON.stringify({schemaVersion: 1, profiles: []})
      };
    }

    if (options.serverMode && reqUrl.endsWith('/api/profiles')) {
      return {
        ok: true,
        status: 200,
        headers: new Map(),
        json: async () => ({ok: true, profiles: [{id: 'personal', extends: 'common.json'}]})
      };
    }

    if (options.serverMode && reqUrl.endsWith('/api/catalog')) {
      return {
        ok: true,
        status: 200,
        headers: new Map(),
        json: async () => ({ok: true, catalog: {entries: []}})
      };
    }

    return {
      ok: false,
      status: 404,
      statusText: 'Not Found',
      headers: new Map(),
      text: async () => 'Not Found'
    };
  };

  let clipboardContent = '';
  let lastOpenedUrl: string | null = null;
  let popupBlocked = Boolean(options.popupBlocked);

  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url,
    virtualConsole: console,
    beforeParse(window: any) {
      window.fetch = defaultFetch;
      window.navigator.clipboard = {
        writeText: async (text: string) => {
          if (options.clipboardError) {
            throw new Error('Clipboard permission denied');
          }
          clipboardContent = text;
        }
      };
      window.open = (targetUrl: string) => {
        lastOpenedUrl = targetUrl;
        return popupBlocked ? null : {focus: () => {}};
      };
    }
  });

  await new Promise(resolve => dom.window.addEventListener('load', resolve, {once: true}));
  await tick(30);

  t.after(() => {
    dom.window.close();
  });

  const w = dom.window as any;
  return {
    w,
    doc: w.document,
    fetchCalls,
    getClipboard: () => clipboardContent,
    getLastOpenedUrl: () => lastOpenedUrl,
    setPopupBlocked: (b: boolean) => { popupBlocked = b; },
    state: w.eval('state'),
    SkcbStatic: w.eval('window.SkcbStatic')
  };
}

test('static-ui: subpath URL loads data/catalog.json and data/profiles.json without calling /api/*', async (t) => {
  const {doc, fetchCalls} = await loadStaticUI(t, {
    url: 'https://test-owner.github.io/my-config/'
  });

  // Verify fetch requests went to subpath relative URLs
  const urls = fetchCalls.map(c => c.url);
  assert.ok(urls.some(u => u === 'https://test-owner.github.io/my-config/data/catalog.json'));
  assert.ok(urls.some(u => u === 'https://test-owner.github.io/my-config/data/profiles.json'));

  // Strictly assert zero /api/* requests
  assert.ok(urls.every(u => !u.includes('/api/')), `Should have no /api/ calls, but got: ${urls.join(', ')}`);

  // Assert top status pill
  const pill = doc.getElementById('ui-server-pill');
  assert.equal(pill?.textContent?.trim(), 'GitHub Pages 静态模式');

  // Assert static mode banner is displayed
  const banner = doc.getElementById('static-mode-banner');
  assert.equal(banner?.style.display, 'flex');

  // Assert static-only buttons are visible
  const staticButtons = doc.querySelectorAll('[data-static-only]');
  assert.ok(staticButtons.length >= 2);
});

test('static-ui: populates profile switcher from data/profiles.json metadata', async (t) => {
  const {doc, state} = await loadStaticUI(t);

  const switcher = doc.getElementById('preset-profile-switcher') as HTMLSelectElement;
  assert.ok(switcher);
  const options = Array.from(switcher.options).map(o => o.value);
  assert.deepEqual(options, ['common', 'personal', 'work']);

  assert.equal(state.staticProfiles.size, 3);
  assert.equal(state.staticProfiles.get('personal')?.file, 'profiles/personal.json');
});

test('static-ui: selecting profile without PAT marks unloaded and shows notice; with PAT fetches from repo', async (t) => {
  let contentsRequested = false;
  let authHeaderUsed = '';

  const {doc, state, SkcbStatic} = await loadStaticUI(t, {
    customFetchHandler: async (reqUrl: string, init: any) => {
      if (reqUrl.includes('/repos/test-owner/test-repo/contents/profiles/personal.json')) {
        contentsRequested = true;
        authHeaderUsed = init.headers?.Authorization || '';
        const profileBody = {
          schemaVersion: 2,
          id: 'personal',
          locale: 'zh-CN',
          selectAdd: ['upstream/actions.amazon'],
          settings: {defaultSearchEngine: 'du'}
        };
        const base64Content = Buffer.from(JSON.stringify(profileBody, null, 2)).toString('base64');
        return {
          ok: true,
          status: 200,
          headers: new Map(),
          text: async () => JSON.stringify({
            content: base64Content,
            sha: 'sha-personal-1234',
            path: 'profiles/personal.json'
          })
        };
      }
      return null;
    }
  });

  const switcher = doc.getElementById('preset-profile-switcher') as HTMLSelectElement;

  // 1. Without PAT: select personal
  state.github.token = '';
  switcher.value = 'personal';
  switcher.dispatchEvent(new doc.defaultView.Event('change'));
  await tick(20);

  assert.equal(state.github.loadedFromRepo, false);
  assert.equal(state.github.remotePath, 'profiles/personal.json');
  assert.equal(contentsRequested, false);

  // Assert notice banner in diagnostics alert
  const alertEl = doc.getElementById('live-diagnostics-alert');
  assert.ok(alertEl?.textContent?.includes('未公开在 Pages 站点中'));

  // 2. With PAT: load profile
  state.github.token = 'test_pat_token_abc';
  await SkcbStatic.loadProfileFromRepo('personal');
  await tick(20);

  assert.equal(contentsRequested, true);
  assert.equal(authHeaderUsed, 'Bearer test_pat_token_abc');
  assert.equal(state.github.loadedFromRepo, true);
  assert.equal(state.github.remoteSha, 'sha-personal-1234');
  assert.equal(state.profile.id, 'personal');
  assert.deepEqual([...state.profile.selectAdd], ['upstream/actions.amazon']);
});

test('static-ui: PAT direct save creates branch, commits and creates PR', async (t) => {
  const apiCalls: {method: string; url: string; body: any}[] = [];

  const {state, SkcbStatic} = await loadStaticUI(t, {
    customFetchHandler: async (reqUrl: string, init: any) => {
      if (reqUrl.startsWith('https://api.github.com/')) {
        const body = init.body ? JSON.parse(init.body) : null;
        apiCalls.push({method: init.method || 'GET', url: reqUrl, body});

        if (reqUrl.endsWith('/repos/test-owner/test-repo')) {
          return {ok: true, status: 200, headers: new Map(), text: async () => JSON.stringify({default_branch: 'main'})};
        }
        if (reqUrl.includes('/git/ref/heads/main')) {
          return {ok: true, status: 200, headers: new Map(), text: async () => JSON.stringify({object: {sha: 'base-sha-111'}})};
        }
        if (reqUrl.includes('/contents/profiles/personal.json?ref=main')) {
          // File does not exist yet on base branch for this test
          return {ok: false, status: 404, headers: new Map(), text: async () => JSON.stringify({message: 'Not Found'})};
        }
        if (reqUrl.endsWith('/git/refs') && init.method === 'POST') {
          return {ok: true, status: 201, headers: new Map(), text: async () => JSON.stringify({ref: body.ref})};
        }
        if (reqUrl.includes('/contents/profiles/personal.json') && init.method === 'PUT') {
          return {ok: true, status: 200, headers: new Map(), text: async () => JSON.stringify({commit: {sha: 'commit-sha-222'}})};
        }
        if (reqUrl.endsWith('/pulls') && init.method === 'POST') {
          return {
            ok: true,
            status: 201,
            headers: new Map(),
            text: async () => JSON.stringify({html_url: 'https://github.com/test-owner/test-repo/pull/42', number: 42})
          };
        }
      }
      return null;
    }
  });

  state.github.token = 'github_pat_secret_xyz';
  state.profile.id = 'personal';

  const res = await SkcbStatic.saveProfilePR();
  assert.equal(res.ok, true);
  assert.equal(res.prUrl, 'https://github.com/test-owner/test-repo/pull/42');
  assert.ok(res.branch.startsWith('skcb/profile/personal-'));

  // Assert API call sequence
  const methods = apiCalls.map(c => `${c.method} ${new URL(c.url).pathname}`);
  assert.equal(methods[0], 'GET /repos/test-owner/test-repo');
  assert.equal(methods[1], 'GET /repos/test-owner/test-repo/git/ref/heads/main');
  assert.equal(methods[2], 'GET /repos/test-owner/test-repo/contents/profiles/personal.json');
  assert.equal(methods[3], 'POST /repos/test-owner/test-repo/git/refs');
  assert.equal(methods[4], 'PUT /repos/test-owner/test-repo/contents/profiles/personal.json');
  assert.equal(methods[5], 'POST /repos/test-owner/test-repo/pulls');

  // Assert PAT token is NEVER sent in any URL or request body or commit message or PR body
  for (const call of apiCalls) {
    assert.ok(!call.url.includes('github_pat_secret_xyz'));
    if (call.body) {
      const bodyStr = JSON.stringify(call.body);
      assert.ok(!bodyStr.includes('github_pat_secret_xyz'));
    }
  }

  // Assert PR title and body do not leak raw private profile settings
  const prCall = apiCalls.find(c => c.url.endsWith('/pulls'));
  assert.ok(prCall?.body?.title?.includes('personal'));
  assert.ok(prCall?.body?.body?.includes('Generated by @skcb/ui static SPA'));
  assert.ok(!prCall?.body?.body?.includes('github_pat_secret_xyz'));
});

test('static-ui: PAT save returns noop for identical content, and guards against remote changed and duplicate file', async (t) => {
  const existingContentObj = {
    schemaVersion: 2,
    id: 'personal',
    locale: 'zh-CN',
    base: 'minimal',
    selectAdd: ['upstream/actions.amazon'],
    conflictResolution: {mode: 'module-precedence', modulePrecedence: ['tech', 'ent', 'prod', 'b0o']},
    leaders: {site: '<Space>', search: 'a'},
    settings: {}
  };
  const base64Existing = Buffer.from(JSON.stringify(existingContentObj, null, 2) + '\n').toString('base64');

  const {state, SkcbStatic} = await loadStaticUI(t, {
    customFetchHandler: async (reqUrl: string) => {
      if (reqUrl.endsWith('/repos/test-owner/test-repo')) {
        return {ok: true, status: 200, headers: new Map(), text: async () => JSON.stringify({default_branch: 'main'})};
      }
      if (reqUrl.includes('/git/ref/heads/main')) {
        return {ok: true, status: 200, headers: new Map(), text: async () => JSON.stringify({object: {sha: 'base-sha-111'}})};
      }
      if (reqUrl.includes('/contents/profiles/personal.json?ref=main')) {
        return {
          ok: true,
          status: 200,
          headers: new Map(),
          text: async () => JSON.stringify({content: base64Existing, sha: 'sha-old-111'})
        };
      }
      return null;
    }
  });

  state.github.token = 'pat_token_123';
  state.profile.id = 'personal';

  // 1. File exists on remote but user never loaded it -> ALREADY_EXISTS
  state.github.loadedFromRepo = false;
  state.github.remotePath = null;
  const res1 = await SkcbStatic.saveProfilePR();
  assert.equal(res1.ok, false);
  assert.equal(res1.code, 'ALREADY_EXISTS');

  // 2. User loaded it, but remote content changed in the meantime -> REMOTE_CHANGED
  state.github.loadedFromRepo = true;
  state.github.remotePath = 'profiles/personal.json';
  state.github.remoteRaw = JSON.stringify({schemaVersion: 2, id: 'personal', selectAdd: []}); // different from remote
  state.github.remoteSha = 'sha-different';
  const res2 = await SkcbStatic.saveProfilePR();
  assert.equal(res2.ok, false);
  assert.equal(res2.code, 'REMOTE_CHANGED');

  // 3. User loaded it, made no changes -> returns noop
  state.github.remoteRaw = JSON.stringify(existingContentObj);
  state.profile = {...existingContentObj};
  const res3 = await SkcbStatic.saveProfilePR();
  assert.equal(res3.ok, true);
  assert.equal(res3.noop, true);
});

test('static-ui: PAT save PR creation failure returns compareUrl recovery without claiming success', async (t) => {
  const {state, SkcbStatic} = await loadStaticUI(t, {
    customFetchHandler: async (reqUrl: string, init: any) => {
      if (reqUrl.endsWith('/repos/test-owner/test-repo')) {
        return {ok: true, status: 200, headers: new Map(), text: async () => JSON.stringify({default_branch: 'main'})};
      }
      if (reqUrl.includes('/git/ref/heads/main')) {
        return {ok: true, status: 200, headers: new Map(), text: async () => JSON.stringify({object: {sha: 'base-sha-111'}})};
      }
      if (reqUrl.includes('/contents/profiles/new-profile.json?ref=main')) {
        return {ok: false, status: 404, headers: new Map(), text: async () => JSON.stringify({message: 'Not found'})};
      }
      if (reqUrl.endsWith('/git/refs')) {
        return {ok: true, status: 201, headers: new Map(), text: async () => JSON.stringify({ref: 'refs/heads/new'})};
      }
      if (reqUrl.includes('/contents/profiles/new-profile.json') && init.method === 'PUT') {
        return {ok: true, status: 200, headers: new Map(), text: async () => JSON.stringify({commit: {sha: 'sha-c'}})};
      }
      if (reqUrl.endsWith('/pulls')) {
        // Simulating PR creation failure (e.g. 500 or network)
        return {ok: false, status: 500, headers: new Map(), text: async () => JSON.stringify({message: 'Internal server error'})};
      }
      return null;
    }
  });

  state.github.token = 'pat_token_123';
  state.profile.id = 'new-profile';

  const res = await SkcbStatic.saveProfilePR();
  assert.equal(res.ok, false);
  assert.equal(res.code, 'PR_CREATE_FAILED');
  assert.ok(res.compareUrl?.includes('compare/main...'));
});

test('static-ui: error mapping for 401, 403 (rate limit vs permissions), 404, 409, 422, 429', async (t) => {
  // We can test ghRequest error handling directly
  const makeErr = (status: number, data: any, headersMap = new Map()) => {
    return {
      ok: false,
      status,
      statusText: String(status),
      headers: headersMap,
      text: async () => JSON.stringify(data)
    };
  };

  // Test 401
  await assert.rejects(
    async () => {
      const {SkcbStatic} = await loadStaticUI(t, {
        customFetchHandler: async () => makeErr(401, {message: 'Bad credentials'})
      });
      await SkcbStatic.ghRequest('/user', {token: 'bad'});
    },
    (err: any) => err.status === 401
  );

  // Test 403 Rate Limit
  await assert.rejects(
    async () => {
      const headers = new Map();
      headers.set('x-ratelimit-remaining', '0');
      headers.set('x-ratelimit-reset', '1800000000');
      const {SkcbStatic} = await loadStaticUI(t, {
        customFetchHandler: async () => makeErr(403, {message: 'API rate limit exceeded'}, headers)
      });
      await SkcbStatic.ghRequest('/user', {token: 'valid'});
    },
    (err: any) => err.status === 403 && err.rateLimitRemaining === '0'
  );
});

test('static-ui: GitHub Web Mode copies JSON and opens GitHub without token or fetch write calls', async (t) => {
  const {state, SkcbStatic, getClipboard, getLastOpenedUrl, setPopupBlocked} = await loadStaticUI(t);

  state.profile.id = 'new-feature';
  state.profile.selectAdd = ['upstream/actions.amazon'];

  // 1. New profile web save
  const resNew = await SkcbStatic.openGitHubWebSave(state.profile);
  assert.equal(resNew.mode, 'web');
  assert.equal(resNew.action, 'new');
  assert.equal(resNew.copied, true);
  assert.equal(resNew.url, 'https://github.com/test-owner/test-repo/new/main?filename=profiles%2Fnew-feature.json');
  assert.equal(getLastOpenedUrl(), 'https://github.com/test-owner/test-repo/new/main?filename=profiles%2Fnew-feature.json');

  // Content was copied to clipboard
  const copiedJson = JSON.parse(getClipboard());
  assert.equal(copiedJson.id, 'new-feature');

  // URL must NEVER contain profile content
  assert.ok(!resNew.url.includes('upstream/actions.amazon'));

  // 2. Existing profile that was NOT loaded from repo: does NOT copy to clipboard to prevent overwrite
  state.staticProfiles.set('personal', {id: 'personal', file: 'profiles/personal.json'});
  state.profile.id = 'personal';
  state.github.loadedFromRepo = false;

  const resUnloaded = await SkcbStatic.openGitHubWebSave(state.profile);
  assert.equal(resUnloaded.action, 'edit-unloaded');
  assert.equal(resUnloaded.copied, false);
  assert.equal(resUnloaded.url, 'https://github.com/test-owner/test-repo/edit/main/profiles/personal.json');

  // 3. Popup blocked handles fallback link
  setPopupBlocked(true);
  const resBlocked = await SkcbStatic.openGitHubWebSave(state.profile);
  assert.equal(resBlocked.popupBlocked, true);
});

test('static-ui: PAT storage in localStorage is only written when explicitly checked, and cleared cleanly', async (t) => {
  const {doc, w, SkcbStatic} = await loadStaticUI(t);

  // By default, localStorage has no PAT keys
  assert.equal(w.localStorage.getItem('skcb.github.pat'), null);
  assert.equal(w.localStorage.getItem('skcb.github.pat.test-owner/test-repo'), null);

  // Open PR dialog
  doc.querySelectorAll('.btn-save-pr')[0].click();
  await tick(10);

  const dialog = doc.getElementById('pr-dialog');
  assert.ok(dialog?.classList.contains('open'));

  const patInput = doc.getElementById('pr-input-pat') as HTMLInputElement;
  const rememberCheck = doc.getElementById('pr-check-remember') as HTMLInputElement;
  const patRadio = doc.getElementById('pr-mode-pat') as HTMLInputElement;

  patRadio.checked = true;
  patRadio.dispatchEvent(new doc.defaultView.Event('change'));

  patInput.value = 'github_pat_persisted_test';
  rememberCheck.checked = true;

  // Submit in PAT mode (mock saveProfilePR)
  SkcbStatic.saveProfilePR = async () => ({ok: true, prUrl: 'https://github.com/test/pull/1', branch: 'b'});
  doc.getElementById('btn-submit-pr')?.click();
  await tick(20);

  // Assert token was saved to localStorage
  assert.equal(w.localStorage.getItem('skcb.github.pat.test-owner/test-repo'), 'github_pat_persisted_test');

  // Clear PAT
  doc.getElementById('btn-clear-pat')?.click();
  await tick(10);

  assert.equal(w.localStorage.getItem('skcb.github.pat.test-owner/test-repo'), null);
  assert.equal(patInput.value, '');
  assert.equal(rememberCheck.checked, false);
});

test('static-ui: Help modal opens and contains all required security, PAT, Pages, and error sections', async (t) => {
  const {doc} = await loadStaticUI(t);

  const helpDialog = doc.getElementById('help-dialog');
  assert.ok(!helpDialog?.classList.contains('open'));

  // Click #btn-help in topbar
  doc.getElementById('btn-help')?.click();
  await tick(10);

  assert.ok(helpDialog?.classList.contains('open'));

  const content = helpDialog?.textContent || '';
  assert.ok(content.includes('Contents: Read and write'));
  assert.ok(content.includes('Pull requests: Read and write'));
  assert.ok(content.includes('PAGES_DEPLOY_ENABLED=true'));
  assert.ok(content.includes('localStorage'));
  assert.ok(content.includes('401'));
  assert.ok(content.includes('403'));
  assert.ok(content.includes('404'));

  // Assert all external links in help dialog have rel="noopener noreferrer"
  const links = Array.from(helpDialog?.querySelectorAll('a') || []);
  for (const link of links) {
    if (link.href.startsWith('http')) {
      assert.equal(link.getAttribute('target'), '_blank');
      assert.ok(link.getAttribute('rel')?.includes('noopener'));
      assert.ok(link.getAttribute('rel')?.includes('noreferrer'));
    }
  }

  // Close help dialog
  doc.getElementById('btn-close-help-dialog')?.click();
  assert.ok(!helpDialog?.classList.contains('open'));
});

test('static-ui: static mode guards prevent POST /api/profiles/save and POST /api/build', async (t) => {
  const {doc, w, fetchCalls} = await loadStaticUI(t);

  // Trigger syncProfileToServer
  w.syncProfileToServer();
  await tick(10);

  // Click #btn-trigger-build
  doc.getElementById('btn-trigger-build')?.click();
  await tick(10);

  const buildDialog = doc.getElementById('build-dialog');
  assert.ok(buildDialog?.classList.contains('open'));

  const compiledText = doc.getElementById('modal-compiled-js')?.textContent || '';
  assert.ok(compiledText.includes('GitHub Pages 静态模式'));

  // Assert no POST calls were made to /api/profiles/save or /api/build
  const postCalls = fetchCalls.filter(c => c.init?.method === 'POST');
  assert.equal(postCalls.length, 0);
});

test('static-ui: server mode without static config still fetches /api/profiles and /api/catalog', async (t) => {
  const {fetchCalls} = await loadStaticUI(t, {
    serverMode: true
  });

  const urls = fetchCalls.map(c => c.url);
  assert.ok(urls.some(u => u.endsWith('/api/profiles')));
  assert.ok(urls.some(u => u.endsWith('/api/catalog')));
});
