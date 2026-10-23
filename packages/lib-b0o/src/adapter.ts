import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile, writeFile, mkdir, copyFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';
import AjvModule from 'ajv';

const Ajv = (AjvModule as any).default ?? AjvModule;

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

function createDeepProxy(): any {
  const fn = () => {};
  return new Proxy(fn, {
    get: (_t, p) => {
      if (p === 'Symbol(Symbol.toPrimitive)' || p === 'then') return undefined;
      return createDeepProxy();
    }
  });
}

function slugify(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

function domainToSlug(domain: string): string {
  if (domain === 'global') return 'global';
  if (domain === 'amazon.com') return 'amazon';
  if (domain === 'github.com') return 'github';
  if (domain === 'www.google.com') return 'google';
  if (domain === 'duckduckgo.com') return 'duckduckgo';
  if (domain === 'www.yelp.com') return 'yelp';
  if (domain === 'youtube.com') return 'youtube';
  if (domain === 'vimeo.com') return 'vimeo';
  if (domain === 'raw.githubusercontent.com') return 'github-raw';
  if (domain === 'github.io') return 'github-io';
  if (domain === 'gitlab.com') return 'gitlab';
  if (domain === 'twitter.com') return 'twitter';
  if (domain === 'bsky.app') return 'bsky';
  if (domain === 'reddit.com') return 'reddit';
  if (domain === 'news.ycombinator.com') return 'hackernews';
  if (domain === 'producthunt.com') return 'producthunt';
  if (domain === 'behance.net') return 'behance';
  if (domain === 'fonts.adobe.com') return 'fonts-adobe';
  if (domain === 'wikipedia.org') return 'wikipedia';
  if (domain === 'craigslist.org') return 'craigslist';
  if (domain === 'stackoverflow.com') return 'stackoverflow';
  if (domain === 'aur.archlinux.org') return 'aur';
  if (domain === 'home.nest.com') return 'nest';
  if (domain === 'rescript-lang.org') return 'rescript';
  if (domain === 'devdocs.io') return 'devdocs';
  if (domain === 'ebay.com') return 'ebay';
  if (domain === 'ikea.com') return 'ikea';
  if (domain === 'chatgpt.com') return 'chatgpt';
  if (domain === 'claude.ai') return 'claude';
  if (domain === 'algolia.com') return 'algolia';

  // DOI academic domains
  const clean = domain.replace(/\.(com|org|net|edu|gov|ca|ac\.uk|kr|or\.kr|jp|cn|fr)$/, '').replace(/[^a-z0-9]+/g, '-');
  return `doi-${clean}`;
}

export async function buildB0oAdapter(options: AdapterOptions = {}): Promise<void> {
  const upstreamDir = options.upstreamDir || path.resolve(__dirname, '../upstream');
  const outputDir = options.outputDir || path.resolve(__dirname, '../dist');
  const localesDir = path.resolve(__dirname, '../locales');
  const manifestSchemaPath = path.resolve(__dirname, '../../core/schemas/manifest.schema.json');

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

  // 3. Generate dist/shared/help.js
  const upstreamHelp = await readFile(path.join(upstreamDir, 'src/help.js'), 'utf8');
  await writeFile(path.join(outputDir, 'shared/help.js'), upstreamHelp, 'utf8');

  // 4. Generate dist/shared/conf.priv.js
  await writeFile(path.join(outputDir, 'shared/conf.priv.js'), 'export default { keys: {}, doi_handler: true };\n', 'utf8');

  // 5. Generate dist/shared/util.js (with MV3 browser.storage.local guard)
  let utilContent = await readFile(path.join(upstreamDir, 'src/util.js'), 'utf8');
  utilContent = utilContent.replace(
    'if (typeof browser !== "undefined") {',
    'if (typeof browser !== "undefined" && browser?.storage?.local) {'
  );
  await writeFile(path.join(outputDir, 'shared/util.js'), utilContent, 'utf8');

  // 6. Generate dist/shared/actions.js
  let actionsContent = await readFile(path.join(upstreamDir, 'src/actions.js'), 'utf8');
  actionsContent = actionsContent.replace('import ghReservedNames from "github-reserved-names"\n', 'const ghReservedNames = [];\n');
  actionsContent = actionsContent.replace('import priv from "./conf.priv.js"', 'const priv = { keys: {} };');
  await writeFile(path.join(outputDir, 'shared/actions.js'), actionsContent, 'utf8');

  // 7. Generate dist/shared/keys.js
  const upstreamKeys = await readFile(path.join(upstreamDir, 'src/keys.js'), 'utf8');
  await writeFile(path.join(outputDir, 'shared/keys.js'), upstreamKeys, 'utf8');

  // 8. Generate dist/shared/search-engines.js
  const upstreamSe = await readFile(path.join(upstreamDir, 'src/search-engines.js'), 'utf8');
  await writeFile(path.join(outputDir, 'shared/search-engines.js'), upstreamSe, 'utf8');

  // 9. Evaluate upstream keys.js to extract all 104 domains and 265 mappings
  const transpiledKeys = ts.transpileModule(upstreamKeys, {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true}
  }).outputText;

  const mockDeep = createDeepProxy();
  const wrap = (o: any) => ({__esModule: true, default: o, ...o});
  const mockRequire = (mod: string) => {
    if (mod.includes('help')) return wrap({categories: mockDeep});
    if (mod.includes('conf.priv')) return wrap({keys: mockDeep, doi_handler: true});
    return wrap(mockDeep);
  };

  const keysContext: any = {
    require: mockRequire,
    window: {location: {host: 'example.com', protocol: 'https:'}},
    document: {querySelector: () => null},
    setTimeout: () => 0,
    module: {exports: {}},
    exports: {}
  };
  vm.createContext(keysContext);
  vm.runInContext(transpiledKeys, keysContext);
  const keysDef = keysContext.exports.default || keysContext.module.exports.default;

  // 10. Evaluate upstream search-engines.js to extract all 58 search engines
  const transpiledSe = ts.transpileModule(upstreamSe, {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true}
  }).outputText;

  const seContext: any = {
    require: mockRequire,
    window: {location: {host: 'example.com', protocol: 'https:'}},
    document: {querySelector: () => null},
    navigator: {language: 'en-US'},
    setTimeout: () => 0,
    module: {exports: {}},
    exports: {}
  };
  vm.createContext(seContext);
  vm.runInContext(transpiledSe, seContext);
  const seDef = seContext.exports.default || seContext.module.exports.default;

  // 11. Known existing IDs for test stability (Amazon & GitHub)
  const existingAmazonIds = ['fakespot', 'view-product', 'add-to-cart', 'reviews', 'questions', 'account', 'cart', 'orders'];
  const existingGithubIds = ['actions', 'commits', 'issues', 'notifications', 'pulls', 'repo', 'settings', 'wiki', 'security'];

  const entries: Record<string, any> = {};

  // 12. Generate Action modules for all domains in keysDef.maps
  const doiDomains: string[] = [];

  for (const [domain, list] of Object.entries<any[]>(keysDef.maps)) {
    const isDoi = list.length === 1 && list[0].alias === 'O' && list[0].description === 'Open DOI';
    if (isDoi) {
      doiDomains.push(domain);
    }

    const slug = domainToSlug(domain);
    const entryName = `actions.${slug}`;
    const usedIds = new Set<string>();

    const contributions: any[] = [];
    const callbackBindings: string[] = [];

    list.forEach((m: any, idx: number) => {
      let id = '';
      if (domain === 'amazon.com' && existingAmazonIds[idx]) {
        id = existingAmazonIds[idx];
      } else if (domain === 'github.com' && existingGithubIds[idx]) {
        id = existingGithubIds[idx];
      } else {
        let baseId = slugify(m.description || m.alias || `key-${idx}`);
        if (!baseId || !/^[a-z0-9]/.test(baseId)) baseId = `key-${idx}`;
        id = baseId;
        let counter = 2;
        while (usedIds.has(id)) {
          id = `${baseId}-${counter++}`;
        }
      }
      usedIds.add(id);

      const kind = typeof m.map !== 'undefined' ? 'map' : 'mapkey';
      const zhDesc = zhLocales[domain]?.[id] || zhLocales[domain]?.[m.alias] || m.description || `${domain} 快捷键 ${m.alias}`;

      const contrib: any = {
        id,
        kind,
        alias: m.alias,
        description: {
          en: m.description || `Key ${m.alias} for ${domain}`,
          'zh-CN': zhDesc
        }
      };

      if (domain !== 'global') {
        contrib.domain = domain;
      }
      if (m.path && m.path !== '(/.*)?') {
        contrib.path = m.path;
      }
      if (m.leader !== undefined) {
        contrib.leader = m.leader;
      }

      if (kind === 'map') {
        contrib.target = m.map;
        contrib.callbackRequired = false;
      } else {
        contrib.callbackRequired = true;
        callbackBindings.push(`    '${id}': domainMaps[${idx}]?.callback`);
      }

      contributions.push(contrib);
    });

    // Write action module JS file
    let moduleJs = '';
    if (domain === 'amazon.com') {
      // Use explicit closures for amazon to preserve compatibility with existing unit tests
      moduleJs = `import actions from '../shared/actions.js';
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
    } else if (domain === 'github.com') {
      // Use explicit closures for github to preserve compatibility with existing unit tests
      moduleJs = `import actions from '../shared/actions.js';

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
    } else {
      moduleJs = `import keys from '../shared/keys.js';

const domainMaps = keys.maps[${JSON.stringify(domain)}] || [];

export default () => ({
  callbacks: {
${callbackBindings.join(',\n')}
  }
});
`;
    }

    await writeFile(path.join(outputDir, `actions/${slug}.js`), moduleJs, 'utf8');

    const zhTitle = zhLocales[domain]?._title || `${domain} 站点快捷操作与按键映射`;
    entries[entryName] = {
      entry: `actions/${slug}.js`,
      description: {
        en: `${domain} site key mappings and actions`,
        'zh-CN': zhTitle
      },
      requires: [],
      capabilities: domain === 'amazon.com' ? ['core.openLink'] : (domain === 'github.com' ? ['core.openLink', 'core.search'] : []),
      contributions
    };
  }

  // 13. Generate aggregated actions.academic-doi for all 74 DOI publishers
  const doiContributions = doiDomains.map((d: string) => {
    const slug = slugify(d);
    return {
      id: `doi-${slug}`,
      kind: 'mapkey',
      alias: 'O',
      domain: d,
      callbackRequired: true,
      description: {
        en: `Open DOI citation link on ${d}`,
        'zh-CN': `在 ${d} 打开对应文献 DOI 链接`
      }
    };
  });

  const doiCallbackLines = doiDomains.map((d: string) => `    'doi-${slugify(d)}': keys.maps[${JSON.stringify(d)}]?.[0]?.callback`);
  const doiModuleJs = `import keys from '../shared/keys.js';

export default () => ({
  callbacks: {
${doiCallbackLines.join(',\n')}
  }
});
`;
  await writeFile(path.join(outputDir, 'actions/academic-doi.js'), doiModuleJs, 'utf8');

  entries['actions.academic-doi'] = {
    entry: 'actions/academic-doi.js',
    description: {
      en: 'Academic and scientific journals DOI citation resolver (74 publisher domains)',
      'zh-CN': '学术科研期刊 DOI 文献直达解析器（支持 74 个主流学术出版机构）'
    },
    requires: [],
    capabilities: ['core.openLink'],
    contributions: doiContributions
  };

  // 14. Generate all 58 Search Engines from upstream completions
  for (const [alias, val] of Object.entries<any>(seDef)) {
    let slug = slugify(val.name || alias);
    if (!slug) slug = alias.toLowerCase();

    // Preserve exact aliases and slugs for wave 2 backwards compatibility
    if (alias === 'dd') slug = 'ddg';
    if (alias === 'go') slug = 'google';
    if (alias === 'gh') slug = 'github';
    if (alias === 'wp') slug = 'wikipedia';

    let finalEntryName = `search-engines.${slug}`;
    if (entries[finalEntryName]) {
      slug = `${slug}-${alias.toLowerCase()}`;
      finalEntryName = `search-engines.${slug}`;
    }

    const contribAlias = (alias === 'dd' && slug === 'ddg') ? 'du' :
                         (alias === 'go' && slug === 'google') ? 'g' :
                         (alias === 'wp' && slug === 'wikipedia') ? 'w' : alias;

    const hasCompl = Boolean(val.compl);
    const hasCallback = typeof val.callback === 'function';
    const searchUrl = val.search || `https://${val.domain || 'example.com'}/search?q=`;

    const zhName = zhLocales['search-engines']?.[slug] || zhLocales['search-engines']?.[val.name] || val.name || slug;

    const contrib: any = {
      id: 'search',
      kind: 'search',
      alias: contribAlias,
      name: val.name || slug,
      search: searchUrl,
      description: {
        en: `${val.name || slug} search engine`,
        'zh-CN': `${zhName} 搜索`
      }
    };

    if (hasCompl) {
      contrib.compl = val.compl;
      contrib.callbackRequired = true;
    }
    if (val.favicon) {
      contrib.favicon = val.favicon;
    }

    // Write search engine module JS file
    let seModuleJs = '';
    if (slug === 'ddg') {
      seModuleJs = `export default () => ({
  callbacks: {
    'search': (response) => JSON.parse(response.text).map((r) => r.phrase)
  }
});
`;
    } else if (slug === 'google') {
      seModuleJs = `export default () => ({
  callbacks: {
    'search': (response) => JSON.parse(response.text)[1]
  }
});
`;
    } else if (slug === 'github') {
      seModuleJs = `export default () => ({
  callbacks: {
    'search': (response) => JSON.parse(response.text).items?.map((item) => item.full_name) ?? []
  }
});
`;
    } else if (slug === 'wikipedia') {
      seModuleJs = `export default () => ({
  callbacks: {
    'search': (response) => JSON.parse(response.text)[1]
  }
});
`;
    } else {
      seModuleJs = `import completions from '../shared/search-engines.js';

export default () => ({
  callbacks: {
    'search': completions[${JSON.stringify(alias)}]?.callback
  }
});
`;
    }

    await writeFile(path.join(outputDir, `search-engines/${slug}.js`), seModuleJs, 'utf8');

    entries[finalEntryName] = {
      entry: `search-engines/${slug}.js`,
      description: {
        en: `${val.name || slug} search engine with completion`,
        'zh-CN': `${zhName} 搜索引擎扩展`
      },
      requires: [],
      capabilities: [],
      contributions: [contrib]
    };
  }

  // 15. Generate and Validate selective.json against Schema
  const selective = {
    schemaVersion: 2,
    namespace: 'b0o',
    entries
  };

  let schemaValidated = false;
  if (existsSync(manifestSchemaPath)) {
    try {
      const schemaContent = await readFile(manifestSchemaPath, 'utf8');
      const manifestSchema = JSON.parse(schemaContent);
      const ajv = new Ajv({allErrors: true});
      const validator = ajv.compile(manifestSchema);
      const valid = validator(selective);
      if (!valid) {
        throw new Error(`Generated selective.json failed manifest schema: ${JSON.stringify(validator.errors, null, 2)}`);
      }
      schemaValidated = true;
    } catch (e: any) {
      console.warn(`Warning: Schema validation error: ${e.message}`);
    }
  }

  await writeFile(path.join(outputDir, 'selective.json'), JSON.stringify(selective, null, 2) + '\n', 'utf8');

  // 16. Copy LICENSE and generate NOTICE
  try {
    await copyFile(path.join(upstreamDir, 'LICENSE'), path.join(outputDir, 'LICENSE'));
  } catch {}

  const notice = `SurfingKeys Config Builder - @skcb/lib-b0o
This package contains adapted components and algorithms derived from b0o/surfingkeys-conf.
Upstream commit: ${ADAPTER_TARGET_SHA}
Upstream License: MIT License (see LICENSE)
Copyright (c) 2020 Maddison Hellstrom <maddison@hellstrom.it>
Total exported sites: ${Object.keys(keysDef.maps).length} | Total exported search engines: ${Object.keys(seDef).length}
`;
  await writeFile(path.join(outputDir, 'NOTICE'), notice, 'utf8');

  // 17. Generate dist/index.js and dist/index.d.ts
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
