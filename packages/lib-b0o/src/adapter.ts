import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile, writeFile, mkdir, copyFile, stat} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const exec = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const ADAPTER_TARGET_SHA = '80176490f6d04c61d10bcbc20618bd283b94ca23';

export interface AdapterOptions {
  upstreamDir?: string;
  outputDir?: string;
  skipGitCheck?: boolean;
}

export async function verifyUpstreamSubmodule(upstreamDir: string): Promise<string> {
  const gitMarker = path.join(upstreamDir, '.git');
  if (!existsSync(gitMarker)) {
    const err: any = new Error(`Submodule packages/lib-b0o/upstream is not initialized. Run: git submodule update --init`);
    err.code = 'SOURCE_GIT_REQUIRED';
    err.exitCode = 3;
    throw err;
  }

  let head = '';
  try {
    const res = await exec('git', ['-C', upstreamDir, 'rev-parse', 'HEAD']);
    head = res.stdout.trim();
  } catch (e: any) {
    const err: any = new Error(`Failed to query upstream submodule HEAD: ${e.message}`);
    err.code = 'SOURCE_GIT_REQUIRED';
    err.exitCode = 3;
    throw err;
  }

  if (head !== ADAPTER_TARGET_SHA) {
    const err: any = new Error(`Upstream submodule SHA mismatch: expected ${ADAPTER_TARGET_SHA}, found ${head}`);
    err.code = 'UPSTREAM_SHA_MISMATCH';
    err.exitCode = 3;
    throw err;
  }

  const status = await exec('git', ['-C', upstreamDir, 'status', '--porcelain']);
  if (status.stdout.trim().length > 0) {
    const err: any = new Error(`Upstream submodule worktree is dirty`);
    err.code = 'UPSTREAM_DIRTY';
    err.exitCode = 3;
    throw err;
  }

  return head;
}

export async function buildB0oAdapter(options: AdapterOptions = {}): Promise<void> {
  const upstreamDir = options.upstreamDir || path.resolve(__dirname, '../upstream');
  const outputDir = options.outputDir || path.resolve(__dirname, '../dist');
  const localesDir = path.resolve(__dirname, '../locales');

  if (!options.skipGitCheck) {
    await verifyUpstreamSubmodule(upstreamDir);
  }

  await mkdir(path.join(outputDir, 'actions'), {recursive: true});
  await mkdir(path.join(outputDir, 'search-engines'), {recursive: true});
  await mkdir(path.join(outputDir, 'shared'), {recursive: true});

  // 1. Load locales
  let zhLocales: any = {};
  try {
    const zhContent = await readFile(path.join(localesDir, 'zh-CN.json'), 'utf8');
    zhLocales = JSON.parse(zhContent);
  } catch {}

  // 2. Generate dist/shared/api.js
  const upstreamApi = await readFile(path.join(upstreamDir, 'src/api.js'), 'utf8');
  await writeFile(path.join(outputDir, 'shared/api.js'), upstreamApi, 'utf8');

  // 3. Generate dist/shared/conf.priv.js (safe stub)
  const stubPriv = `export default { keys: {} };\n`;
  await writeFile(path.join(outputDir, 'shared/conf.priv.js'), stubPriv, 'utf8');

  // 4. Generate dist/shared/util.js (with MV3 browser.storage.local guard)
  let utilContent = await readFile(path.join(upstreamDir, 'src/util.js'), 'utf8');
  // MV3 guard injection
  utilContent = utilContent.replace(
    'if (typeof browser !== "undefined") {',
    'if (typeof browser !== "undefined" && browser?.storage?.local) {'
  );
  await writeFile(path.join(outputDir, 'shared/util.js'), utilContent, 'utf8');

  // 5. Generate dist/shared/actions.js
  let actionsContent = await readFile(path.join(upstreamDir, 'src/actions.js'), 'utf8');
  actionsContent = actionsContent.replace('import ghReservedNames from "github-reserved-names"\n', 'const ghReservedNames = [];\n');
  actionsContent = actionsContent.replace('import priv from "./conf.priv.js"', 'import priv from "./conf.priv.js"');
  await writeFile(path.join(outputDir, 'shared/actions.js'), actionsContent, 'utf8');

  // 6. Generate Actions modules
  // 6.1 Amazon
  const amazonModule = `import actions from '../shared/actions.js';
import util from '../shared/util.js';

export default () => ({
  callbacks: {
    'fakespot': actions.fakeSpot,
    'view-product': actions.az.viewProduct,
    'add-to-cart': () => util.createHints("#add-to-cart-button"),
    'reviews': () => actions.openLink("#customerReviews"),
    'questions': () => actions.openLink("#Ask"),
    'account': () => actions.openLink("/gp/css/homepage.html"),
    'cart': () => actions.openLink("/gp/cart/view.html"),
    'orders': () => actions.openLink("/gp/css/order-history")
  }
});
`;
  await writeFile(path.join(outputDir, 'actions/amazon.js'), amazonModule, 'utf8');

  // 6.2 GitHub
  const githubModule = `import actions from '../shared/actions.js';

export default () => ({
  callbacks: {
    'actions': () => actions.gh.openRepoPage("/actions"),
    'commits': () => actions.gh.openRepoPage("/commits"),
    'issues': () => actions.gh.openRepoPage("/issues"),
    'notifications': () => actions.gh.openPage("/notifications"),
    'pulls': () => actions.gh.openRepoPage("/pulls"),
    'repo': () => actions.gh.openRepoPage("/"),
    'settings': () => actions.gh.openRepoPage("/settings"),
    'wiki': () => actions.gh.openRepoPage("/wiki"),
    'security': () => actions.gh.openRepoPage("/security")
  }
});
`;
  await writeFile(path.join(outputDir, 'actions/github.js'), githubModule, 'utf8');

  // 7. Generate Search Engines modules
  // 7.1 DDG
  const ddgModule = `export default () => ({
  callbacks: {
    'search': (response) => JSON.parse(response.text).map((r) => r.phrase)
  }
});
`;
  await writeFile(path.join(outputDir, 'search-engines/ddg.js'), ddgModule, 'utf8');

  // 7.2 Google
  const googleModule = `export default () => ({
  callbacks: {
    'search': (response) => JSON.parse(response.text)[1]
  }
});
`;
  await writeFile(path.join(outputDir, 'search-engines/google.js'), googleModule, 'utf8');

  // 7.3 GitHub Search
  const ghSearchModule = `export default () => ({
  callbacks: {
    'search': (response) => JSON.parse(response.text).items?.map((item) => item.full_name) ?? []
  }
});
`;
  await writeFile(path.join(outputDir, 'search-engines/github.js'), ghSearchModule, 'utf8');

  // 7.4 Wikipedia Search
  const wikiSearchModule = `export default () => ({
  callbacks: {
    'search': (response) => JSON.parse(response.text)[1]
  }
});
`;
  await writeFile(path.join(outputDir, 'search-engines/wikipedia.js'), wikiSearchModule, 'utf8');

  // 8. Generate selective.json
  const selective = {
    schemaVersion: 1,
    namespace: 'b0o',
    entries: {
      'actions.amazon': {
        entry: 'actions/amazon.js',
        description: {
          en: 'Amazon site functionality',
          'zh-CN': zhLocales['amazon.com']?._title || '亚马逊站点快捷操作'
        },
        requires: [],
        capabilities: ['core.openLink'],
        contributions: [
          {
            id: 'fakespot',
            alias: 'fs',
            description: {
              en: 'Fakespot',
              'zh-CN': zhLocales['amazon.com']?.['fakespot'] || 'Fakespot 虚假评价分析'
            },
            kind: 'mapkey',
            domain: 'amazon.com',
            callbackRequired: true
          },
          {
            id: 'view-product',
            alias: 'a',
            description: {
              en: 'View product',
              'zh-CN': zhLocales['amazon.com']?.['view-product'] || '查看商品详情'
            },
            kind: 'mapkey',
            domain: 'amazon.com',
            callbackRequired: true
          },
          {
            id: 'add-to-cart',
            alias: 'c',
            description: {
              en: 'Add to Cart',
              'zh-CN': zhLocales['amazon.com']?.['add-to-cart'] || '加入购物车'
            },
            kind: 'mapkey',
            domain: 'amazon.com',
            callbackRequired: true
          },
          {
            id: 'reviews',
            alias: 'R',
            description: {
              en: 'View Product Reviews',
              'zh-CN': zhLocales['amazon.com']?.['reviews'] || '查看商品评价列表'
            },
            kind: 'mapkey',
            domain: 'amazon.com',
            callbackRequired: true
          },
          {
            id: 'questions',
            alias: 'Q',
            description: {
              en: 'View Product Q&A',
              'zh-CN': zhLocales['amazon.com']?.['questions'] || '查看商品问答'
            },
            kind: 'mapkey',
            domain: 'amazon.com',
            callbackRequired: true
          },
          {
            id: 'account',
            alias: 'A',
            description: {
              en: 'Open Account page',
              'zh-CN': zhLocales['amazon.com']?.['account'] || '打开亚马逊账户页面'
            },
            kind: 'mapkey',
            domain: 'amazon.com',
            callbackRequired: true
          },
          {
            id: 'cart',
            alias: 'C',
            description: {
              en: 'Open Cart page',
              'zh-CN': zhLocales['amazon.com']?.['cart'] || '打开购物车页面'
            },
            kind: 'mapkey',
            domain: 'amazon.com',
            callbackRequired: true
          },
          {
            id: 'orders',
            alias: 'O',
            description: {
              en: 'Open Orders page',
              'zh-CN': zhLocales['amazon.com']?.['orders'] || '打开订单历史页面'
            },
            kind: 'mapkey',
            domain: 'amazon.com',
            callbackRequired: true
          }
        ]
      },
      'actions.github': {
        entry: 'actions/github.js',
        description: {
          en: 'GitHub site navigation and quick actions',
          'zh-CN': 'GitHub 仓库快捷导航'
        },
        requires: [],
        capabilities: ['core.openLink'],
        contributions: [
          {
            id: 'actions',
            alias: 'A',
            description: {
              en: 'Open repository Actions page',
              'zh-CN': zhLocales['github.com']?.['actions'] || '打开仓库 Actions 页面'
            },
            kind: 'mapkey',
            domain: 'github.com',
            callbackRequired: true
          },
          {
            id: 'commits',
            alias: 'C',
            description: {
              en: 'Open repository Commits page',
              'zh-CN': zhLocales['github.com']?.['commits'] || '打开仓库 Commits 页面'
            },
            kind: 'mapkey',
            domain: 'github.com',
            callbackRequired: true
          },
          {
            id: 'issues',
            alias: 'I',
            description: {
              en: 'Open repository Issues page',
              'zh-CN': zhLocales['github.com']?.['issues'] || '打开仓库 Issues 页面'
            },
            kind: 'mapkey',
            domain: 'github.com',
            callbackRequired: true
          },
          {
            id: 'notifications',
            alias: 'N',
            description: {
              en: 'Open notifications page',
              'zh-CN': zhLocales['github.com']?.['notifications'] || '打开通知中心'
            },
            kind: 'mapkey',
            domain: 'github.com',
            callbackRequired: true
          },
          {
            id: 'pulls',
            alias: 'P',
            description: {
              en: 'Open repository Pull Requests page',
              'zh-CN': zhLocales['github.com']?.['pulls'] || '打开仓库 PR 页面'
            },
            kind: 'mapkey',
            domain: 'github.com',
            callbackRequired: true
          },
          {
            id: 'repo',
            alias: 'R',
            description: {
              en: 'Open Repository root page',
              'zh-CN': zhLocales['github.com']?.['repo'] || '打开仓库主页'
            },
            kind: 'mapkey',
            domain: 'github.com',
            callbackRequired: true
          },
          {
            id: 'settings',
            alias: 'S',
            description: {
              en: 'Open repository Settings page',
              'zh-CN': zhLocales['github.com']?.['settings'] || '打开仓库设置页面'
            },
            kind: 'mapkey',
            domain: 'github.com',
            callbackRequired: true
          },
          {
            id: 'wiki',
            alias: 'W',
            description: {
              en: 'Open repository Wiki page',
              'zh-CN': zhLocales['github.com']?.['wiki'] || '打开仓库 Wiki 页面'
            },
            kind: 'mapkey',
            domain: 'github.com',
            callbackRequired: true
          },
          {
            id: 'security',
            alias: 'X',
            description: {
              en: 'Open repository Security page',
              'zh-CN': zhLocales['github.com']?.['security'] || '打开仓库安全页面'
            },
            kind: 'mapkey',
            domain: 'github.com',
            callbackRequired: true
          }
        ]
      },
      'search-engines.ddg': {
        entry: 'search-engines/ddg.js',
        description: {
          en: 'DuckDuckGo search engine with completion',
          'zh-CN': zhLocales['search-engines']?.['duckduckgo'] || 'DuckDuckGo 隐私搜索'
        },
        requires: [],
        capabilities: [],
        contributions: [
          {
            id: 'search',
            kind: 'search',
            alias: 'du',
            name: 'duckduckgo',
            search: 'https://duckduckgo.com/?q=',
            compl: 'https://duckduckgo.com/ac/?q=',
            callbackRequired: true,
            description: {
              en: 'DuckDuckGo search',
              'zh-CN': zhLocales['search-engines']?.['duckduckgo'] || 'DuckDuckGo 隐私搜索'
            }
          }
        ]
      },
      'search-engines.google': {
        entry: 'search-engines/google.js',
        description: {
          en: 'Google search engine with completion',
          'zh-CN': zhLocales['search-engines']?.['google'] || 'Google 网页搜索'
        },
        requires: [],
        capabilities: [],
        contributions: [
          {
            id: 'search',
            kind: 'search',
            alias: 'g',
            name: 'google',
            search: 'https://www.google.com/search?q=',
            compl: 'https://suggestqueries.google.com/complete/search?client=chrome&q=',
            callbackRequired: true,
            description: {
              en: 'Google search',
              'zh-CN': zhLocales['search-engines']?.['google'] || 'Google 网页搜索'
            }
          }
        ]
      },
      'search-engines.github': {
        entry: 'search-engines/github.js',
        description: {
          en: 'GitHub repository search',
          'zh-CN': zhLocales['search-engines']?.['github'] || 'GitHub 仓库搜索'
        },
        requires: [],
        capabilities: [],
        contributions: [
          {
            id: 'search',
            kind: 'search',
            alias: 'gh',
            name: 'github',
            search: 'https://github.com/search?q=',
            compl: 'https://api.github.com/search/repositories?q=',
            callbackRequired: true,
            description: {
              en: 'GitHub search',
              'zh-CN': zhLocales['search-engines']?.['github'] || 'GitHub 仓库搜索'
            }
          }
        ]
      },
      'search-engines.wikipedia': {
        entry: 'search-engines/wikipedia.js',
        description: {
          en: 'Wikipedia multilingual encyclopedia search',
          'zh-CN': zhLocales['search-engines']?.['wikipedia'] || '维基百科搜索'
        },
        requires: [],
        capabilities: [],
        contributions: [
          {
            id: 'search',
            kind: 'search',
            alias: 'w',
            name: 'wikipedia',
            search: 'https://en.wikipedia.org/wiki/Special:Search?search=',
            compl: 'https://en.wikipedia.org/w/api.php?action=opensearch&format=json&search=',
            callbackRequired: true,
            description: {
              en: 'Wikipedia search',
              'zh-CN': zhLocales['search-engines']?.['wikipedia'] || '维基百科搜索'
            }
          }
        ]
      }
    }
  };

  await writeFile(path.join(outputDir, 'selective.json'), JSON.stringify(selective, null, 2) + '\n', 'utf8');

  // 9. Copy LICENSE and generate NOTICE
  try {
    await copyFile(path.join(upstreamDir, 'LICENSE'), path.join(outputDir, 'LICENSE'));
  } catch {}

  const notice = `SurfingKeys Config Builder - @skcb/lib-b0o
This package contains adapted components and algorithms derived from b0o/surfingkeys-conf.
Upstream commit: ${ADAPTER_TARGET_SHA}
Upstream License: MIT License (see LICENSE)
Copyright (c) 2020 Maddison Hellstrom <maddison@hellstrom.it>
`;
  await writeFile(path.join(outputDir, 'NOTICE'), notice, 'utf8');

  // 10. Generate dist/index.js and dist/index.d.ts
  const indexJs = `import selective from './selective.json' with { type: 'json' };
export { selective };
export default selective;
`;
  const indexDts = `export declare const selective: Record<string, unknown>;
export default selective;
`;
  await writeFile(path.join(outputDir, 'index.js'), indexJs, 'utf8');
  await writeFile(path.join(outputDir, 'index.d.ts'), indexDts, 'utf8');
}

// Standalone execution
if (process.argv[1] && (process.argv[1].endsWith('adapter.js') || process.argv[1].endsWith('adapter.ts'))) {
  buildB0oAdapter()
    .then(() => {
      console.log('✅ @skcb/lib-b0o build completed successfully.');
    })
    .catch((err) => {
      console.error('❌ @skcb/lib-b0o build failed:', err);
      process.exit(err.exitCode || 1);
    });
}
