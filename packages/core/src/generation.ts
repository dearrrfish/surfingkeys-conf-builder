import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {parse} from '@babel/parser';
import generatorModule from '@babel/generator';
import * as t from '@babel/types';
import traverseModule from '@babel/traverse';
const traverse = traverseModule.default;
import type {Context, Catalog, CodeAnalysis, EffectiveProfile} from './types.js';
import type {Registration} from './registration.js';
import {fail, sourceInput} from './input.js';
const generate = generatorModule.default;

export interface Generation {
  files: string[];
  entry: string;
}

export interface ResolvedSearchEngine {
  name: string;
  url: string;
  canIframe: boolean;
}

export function inferCanIframe(url: string): boolean {
  try {
    const parsed = new URL(url.replace(/\{query\}|\{q\}/g, 'test'));
    const host = parsed.hostname.toLowerCase();
    if (host.includes('bing.com') || host.includes('wikipedia.org') || host.includes('devdocs.io') || host.includes('yandex.') || host.includes('algolia.com') || host.includes('wolframalpha.com')) {
      return true;
    }
  } catch {
    // ignore
  }
  return false;
}

export function resolveSearchEngineItem(
  engine: string | { name: string; url: string; canIframe?: boolean },
  catalog?: Catalog
): ResolvedSearchEngine {
  if (typeof engine === 'object' && engine !== null) {
    const canIframe = engine.canIframe !== undefined
      ? engine.canIframe
      : inferCanIframe(engine.url);
    return { name: engine.name, url: engine.url, canIframe };
  }

  const str = String(engine).trim();
  if (catalog) {
    const matched = catalog.entries.find(e =>
      e.id === str ||
      e.id === `upstream/${str}` ||
      e.id === `b0o/${str}` ||
      e.contributions.some(c => c.kind === 'search' && (c.alias === str || c.name === str))
    );
    if (matched) {
      const contrib = matched.contributions.find(c => c.kind === 'search') || matched.contributions[0];
      const name = contrib?.name || matched.id.split('.').pop() || str;
      const url = contrib?.search || '';
      return { name, url, canIframe: inferCanIframe(url) };
    }
  }

  const lower = str.toLowerCase();
  switch (lower) {
    case 'google':
      return { name: 'Google', url: 'https://www.google.com/search?q={query}', canIframe: false };
    case 'bing':
      return { name: 'Bing', url: 'https://www.bing.com/search?q={query}', canIframe: true };
    case 'duckduckgo':
    case 'ddg':
      return { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q={query}', canIframe: false };
    case 'github':
      return { name: 'GitHub', url: 'https://github.com/search?q={query}', canIframe: false };
    case 'stackoverflow':
    case 'so':
      return { name: 'StackOverflow', url: 'https://stackoverflow.com/search?q={query}', canIframe: false };
    case 'wikipedia':
    case 'wiki':
      return { name: 'Wikipedia', url: 'https://en.wikipedia.org/w/index.php?search={query}', canIframe: true };
    case 'devdocs':
      return { name: 'DevDocs', url: 'https://devdocs.io/#q={query}', canIframe: true };
    case 'mdn':
      return { name: 'MDN', url: 'https://developer.mozilla.org/search?q={query}', canIframe: false };
    case 'hackernews':
    case 'hn':
      return { name: 'HackerNews', url: 'https://hn.algolia.com/?q={query}', canIframe: true };
    case 'reddit':
      return { name: 'Reddit', url: 'https://www.reddit.com/search/?q={query}', canIframe: false };
    case 'crates':
      return { name: 'crates.io', url: 'https://crates.io/search?q={query}', canIframe: false };
    case 'npm':
      return { name: 'npm', url: 'https://www.npmjs.com/search?q={query}', canIframe: false };
    default:
      if (str.includes('://')) {
        return { name: str, url: str, canIframe: inferCanIframe(str) };
      }
      return { name: str, url: 'https://duckduckgo.com/?q={query}', canIframe: false };
  }
}

export function generateSearchGroupRuntime(
  p: EffectiveProfile,
  catalog: Catalog,
  ctxRoot: string
): string {
  const groups = p.searchGroups ?? [];
  if (groups.length === 0) return '';

  const defaultHubPath = path.posix.join(ctxRoot.replace(/\\/g, '/'), 'ui/search-hub/index.html');
  const defaultHubUrl = 'file://' + defaultHubPath;

  const lines: string[] = [
    '// --- Multi-Engine Aggregated Search & Batch Tab Dispatcher ---',
    'const _skcb_open_link = (url, active = false) => {',
    '  if (typeof api !== "undefined" && api && typeof api.RUNTIME === "function") {',
    '    api.RUNTIME("openLink", { tab: { tabbed: true, active: !!active }, url: url });',
    '  } else if (typeof api !== "undefined" && api && typeof api.tabOpenLink === "function") {',
    '    api.tabOpenLink(url);',
    '  } else if (typeof window !== "undefined") {',
    '    window.open(url, "_blank");',
    '  }',
    '};',
    'const _skcb_batch_open = (urls, activeFirst = true) => {',
    '  urls.forEach((url, idx) => {',
    '    _skcb_open_link(url, idx === 0 && activeFirst);',
    '  });',
    '};',
    'const _skcb_format_query = (tmpl, q) => {',
    '  if (tmpl.includes("{query}")) return tmpl.replace(/\\{query\\}/g, encodeURIComponent(q));',
    '  if (tmpl.includes("{q}")) return tmpl.replace(/\\{q\\}/g, encodeURIComponent(q));',
    '  return tmpl + encodeURIComponent(q);',
    '};'
  ];

  for (const g of groups) {
    const leader = g.leader || `og${g.id[0]}`;
    const alias = `_grp_${g.id}`;
    const desc = `#8Aggregated Search: ${g.name}`;
    const mode = g.mode || 'both';
    const hubUrl = g.hubUrl || defaultHubUrl;
    const resolvedEngines = g.engines.map(e => resolveSearchEngineItem(e, catalog));
    const hubTargetUrl = `${hubUrl}${hubUrl.includes('?') ? '&' : '?'}group=${encodeURIComponent(g.id)}${mode === 'tabs' ? '&mode=tabs' : ''}&q=`;

    lines.push(`const _grp_${g.id}_engines = ${JSON.stringify(resolvedEngines)};`);
    lines.push(`api.addSearchAlias(${JSON.stringify(alias)}, ${JSON.stringify(g.name)}, ${JSON.stringify(hubTargetUrl)}, "", undefined, undefined, undefined, { skipMaps: true });`);

    lines.push(`api.mapkey(${JSON.stringify(leader)}, ${JSON.stringify(desc)}, () => {`);
    lines.push(`  const sel = (typeof window !== "undefined" && window.getSelection) ? window.getSelection().toString().trim() : "";`);
    if (mode === 'tabs') {
      lines.push(`  if (sel) {`);
      lines.push(`    _skcb_batch_open(_grp_${g.id}_engines.map(e => _skcb_format_query(e.url, sel)));`);
      lines.push(`  } else {`);
      lines.push(`    api.Front.openOmnibar({ type: "SearchEngine", extra: ${JSON.stringify(alias)} });`);
      lines.push(`  }`);
    } else {
      lines.push(`  if (sel) {`);
      lines.push(`    api.Front.openOmnibar({ type: "SearchEngine", pref: sel, extra: ${JSON.stringify(alias)} });`);
      lines.push(`  } else {`);
      lines.push(`    api.Front.openOmnibar({ type: "SearchEngine", extra: ${JSON.stringify(alias)} });`);
      lines.push(`  }`);
    }
    lines.push(`});`);

    lines.push(`api.mapkey(${JSON.stringify('c' + leader)}, ${JSON.stringify(desc + ' with clipboard')}, () => {`);
    lines.push(`  api.Clipboard.read(c => {`);
    lines.push(`    const clip = (c && c.data) ? c.data.trim() : "";`);
    if (mode === 'tabs') {
      lines.push(`    if (clip) {`);
      lines.push(`      _skcb_batch_open(_grp_${g.id}_engines.map(e => _skcb_format_query(e.url, clip)));`);
      lines.push(`    } else {`);
      lines.push(`      api.Front.openOmnibar({ type: "SearchEngine", extra: ${JSON.stringify(alias)} });`);
      lines.push(`    }`);
    } else {
      lines.push(`    api.Front.openOmnibar({ type: "SearchEngine", pref: clip, extra: ${JSON.stringify(alias)} });`);
    }
    lines.push(`  });`);
    lines.push(`});`);

    lines.push(`api.mapkey(${JSON.stringify('t' + leader)}, ${JSON.stringify(desc + ' (batch open in tabs)')}, () => {`);
    lines.push(`  api.Clipboard.read(c => {`);
    lines.push(`    const sel = (typeof window !== "undefined" && window.getSelection) ? window.getSelection().toString().trim() : "";`);
    lines.push(`    const q = sel || ((c && c.data) ? c.data.trim() : "");`);
    lines.push(`    if (q) {`);
    lines.push(`      _skcb_batch_open(_grp_${g.id}_engines.map(e => _skcb_format_query(e.url, q)));`);
    lines.push(`    } else {`);
    lines.push(`      api.Front.openOmnibar({ type: "SearchEngine", extra: ${JSON.stringify(alias)} });`);
    lines.push(`    }`);
    lines.push(`  });`);
    lines.push(`});`);
  }

  return lines.join('\n');
}

export async function generateGraph(
  ctx: Context,
  catalog: Catalog,
  p: EffectiveProfile,
  result: {resolvedFeatures: string[]; resolvedCapabilities: string[]; registrationIR: {registrations: Registration[]}},
  graph: CodeAnalysis,
  capture: Map<string, string>,
  dir: string
): Promise<Generation> {
  await mkdir(dir, {recursive: true});
  const modules = new Map<string, {text: string; physical: string; root: string}>();
  const imports = new Map<string, string>();

  for (const n of graph.nodes) {
    let physical: string;
    let logical: string;
    let root: string;
    if (n.file.startsWith('src/')) {
      root = ctx.upstream;
      physical = await sourceInput(root, n.file);
      logical = `upstream/${n.file}`;
    } else {
      const f = catalog.entries.find(f => n.file.startsWith(`${f.id}/`))!;
      root = path.resolve(ctx.root, f.source);
      physical = await sourceInput(root, n.file.slice(f.id.length + 1));
      logical = `extensions/${f.id.split('/')[0]}/${path.relative(root, physical).split(path.sep).join('/')}`;
    }
    const text = capture.get(physical);
    if (text === undefined) {
      fail('CAPTURE_MISSING', 'Analysis did not capture generation input', 4);
    }
    if (!imports.has(physical)) {
      modules.set(logical, {text, physical, root});
      imports.set(physical, logical);
    }
  }

  const files: string[] = [];
  for (const [logical, {text, physical, root}] of modules) {
    const ast = parse(text, {sourceType: 'module', createImportExpressions: true});
    if (logical === 'upstream/src/util.js') {
      let guarded = false;
      traverse(ast, {
        VariableDeclarator(p) {
          if (!t.isIdentifier(p.node.id, {name: 'localStorageFns'}) || !t.isArrowFunctionExpression(p.node.init) || !t.isBlockStatement(p.node.init.body)) {
            return;
          }
          const first = p.node.init.body.body[0];
          if (!t.isIfStatement(first) || !t.isBinaryExpression(first.test, {operator: '!=='}) || !t.isUnaryExpression(first.test.left, {operator: 'typeof'}) || !t.isIdentifier(first.test.left.argument, {name: 'browser'}) || !t.isStringLiteral(first.test.right, {value: 'undefined'})) {
            fail('ADAPTER_SHAPE_CHANGE', 'Pinned util storage compatibility shape changed', 3);
          }
          const storage = t.memberExpression(t.identifier('browser'), t.identifier('storage'));
          first.test = t.logicalExpression('&&', t.logicalExpression('&&', first.test, t.cloneNode(storage)), t.memberExpression(storage, t.identifier('local')));
          guarded = true;
        }
      });
      if (!guarded) {
        fail('ADAPTER_SHAPE_CHANGE', 'Pinned util storage binding missing', 3);
      }
    }
    if (logical.startsWith('upstream/')) {
      const file = logical.slice(9);
      const nodes = graph.nodes.filter(n => n.file === file);
      const whole = nodes.some(n => n.symbol === '*');
      if (!whole) {
        const symbols = new Set(nodes.map(n => n.symbol));
        const ranges = new Set(nodes.map(n => `${n.range.start.line}:${n.range.start.column}`));
        const wanted = (n: t.Node) => !!n.loc && ranges.has(`${n.loc.start.line}:${n.loc.start.column}`);
        const body: t.Statement[] = [];
        let callbacks: t.ObjectProperty[] = [];
        for (const statement of ast.program.body) {
          if (t.isImportDeclaration(statement)) {
            body.push(statement);
            continue;
          }
          if (t.isVariableDeclaration(statement)) {
            const ds = statement.declarations.filter(wanted);
            if (ds.length) {
              body.push(t.variableDeclaration(statement.kind, ds.map(d => t.cloneNode(d, true))));
            }
            continue;
          }
          if (t.isFunctionDeclaration(statement) && wanted(statement)) {
            body.push(t.cloneNode(statement, true));
            continue;
          }
          if (t.isExpressionStatement(statement) && t.isAssignmentExpression(statement.expression)) {
            if (wanted(statement.expression.right)) {
              body.push(t.cloneNode(statement, true));
            }
            if (file === 'src/keys.js' && t.isMemberExpression(statement.expression.left) && t.isIdentifier(statement.expression.left.object, {name: 'maps'}) && t.isStringLiteral(statement.expression.left.property, {value: 'amazon.com'}) && t.isArrayExpression(statement.expression.right)) {
              callbacks = statement.expression.right.elements.flatMap((e, i) => {
                if (!symbols.has(`amazonCallback.${i}`) || !t.isObjectExpression(e)) {
                  return [];
                }
                const property = e.properties.find(p => t.isObjectProperty(p) && t.isIdentifier(p.key, {name: 'callback'})) as t.ObjectProperty;
                return [t.objectProperty(t.stringLiteral(String(i)), t.cloneNode(property.value as t.Expression, true))];
              });
            }
            continue;
          }
        }
        if (file === 'src/keys.js') {
          body.push(t.exportNamedDeclaration(t.variableDeclaration('const', [t.variableDeclarator(t.identifier('callbacks'), t.objectExpression(callbacks))])));
        } else {
          const container = file === 'src/actions.js' ? 'actions' : 'completions';
          body.push(t.exportDefaultDeclaration(t.identifier(container)));
        }
        ast.program.body = body;
        const identifiers = new Set<string>();
        traverse(ast, {
          Program(p) {
            p.scope.crawl();
            for (const statement of p.get('body')) {
              if (statement.isImportDeclaration()) {
                for (const spec of statement.node.specifiers) {
                  if (p.scope.getBinding(spec.local.name)?.referenced) {
                    identifiers.add(spec.local.name);
                  }
                }
              }
            }
          }
        });
        ast.program.body = ast.program.body.filter(s => {
          if (!t.isImportDeclaration(s)) { return true; }
          s.specifiers = s.specifiers.filter(spec => identifiers.has(spec.local.name));
          return s.specifiers.length > 0;
        });
      }
    }
    for (const s of ast.program.body) {
      if (t.isImportDeclaration(s) || (t.isExportNamedDeclaration(s) && s.source) || t.isExportAllDeclaration(s)) {
        const source = s.source!;
        if (source.value.startsWith('.')) {
          const target = await sourceInput(root, path.relative(root, path.resolve(path.dirname(physical), source.value)));
          const targetLogical = imports.get(target);
          if (!targetLogical) {
            fail('GENERATED_IMPORT_ESCAPE', `Missing generated dependency ${logical}`, 3);
          }
          source.value = './' + path.posix.relative(path.posix.dirname(logical), targetLogical);
        } else if (!['uhtml', 'dompurify'].includes(source.value)) {
          fail('GENERATED_IMPORT_ESCAPE', 'Unsupported package', 3);
        }
      }
    }
    const output = path.join(dir, logical);
    await mkdir(path.dirname(output), {recursive: true});
    await writeFile(output, generate(ast, {comments: true, compact: false}).code + '\n');
    files.push(logical);
  }

  if (ctx.workspace.schemaVersion === 2) {
    const apiCode = `const getApi = () => {
  if (typeof window === 'undefined') return {};
  if (typeof api !== 'undefined') return { v1: true, ...api };
  return {
    v1: false,
    RUNTIME: typeof RUNTIME !== 'undefined' ? RUNTIME : undefined,
    Clipboard: typeof Clipboard !== 'undefined' ? Clipboard : undefined,
    Normal: typeof Normal !== 'undefined' ? Normal : undefined,
    Hints: typeof Hints !== 'undefined' ? Hints : undefined,
    Front: typeof Front !== 'undefined' ? Front : undefined,
    mapkey: typeof mapkey !== 'undefined' ? mapkey : undefined,
    map: typeof map !== 'undefined' ? map : undefined,
    unmap: typeof unmap !== 'undefined' ? unmap : undefined,
    addSearchAlias: typeof addSearchAlias !== 'undefined' ? addSearchAlias : undefined,
    removeSearchAlias: typeof removeSearchAlias !== 'undefined' ? removeSearchAlias : undefined
  };
};
export default getApi();\n`;
    await mkdir(path.join(dir, 'core'), {recursive: true});
    await writeFile(path.join(dir, 'core/api.js'), apiCode);
    files.push('core/api.js');
  }

  const factoryImports: string[] = [];
  const factories: string[] = [];
  for (const [index, id] of result.resolvedFeatures.entries()) {
    const feature = catalog.entries.find(f => f.id === id)!;
    if (feature.source === 'upstream') { continue; }
    const target = imports.get(await sourceInput(path.resolve(ctx.root, feature.source), feature.entry));
    if (!target) {
      fail('GENERATED_IMPORT_ESCAPE', 'Missing generated factory', 3);
    }
    factoryImports.push(`import factory${index} from './${target}';`);
    factories.push(
      `{id:${JSON.stringify(id)},factory:factory${index},ids:${JSON.stringify(feature.contributions.filter(c => c.kind !== 'map').map(c => c.id))},required:${JSON.stringify(feature.contributions.filter(c => c.kind === 'mapkey' || (c.kind === 'search' && (c.callbackRequired || !!c.compl))).map(c => c.id))},capabilities:${JSON.stringify(feature.capabilities ?? [])}}`
    );
  }

  const hasAmazon = graph.nodes.some(n => n.symbol.startsWith('amazonCallback.'));
  const hasSearch = graph.nodes.some(n => n.file === 'src/search-engines.js');
  const hasActions = graph.nodes.some(n => n.file === 'src/actions.js');
  const roots = [
    ctx.workspace.schemaVersion === 2
      ? "import api from './core/api.js';"
      : "import api from './upstream/src/api.js';",
    ...(hasAmazon ? ["import {callbacks as amazonCallbacks} from './upstream/src/keys.js';"] : []),
    ...(hasSearch ? ["import completions from './upstream/src/search-engines.js';"] : []),
    ...(hasActions ? ["import actions from './upstream/src/actions.js';"] : []),
    ...factoryImports
  ];

  const registrations = result.registrationIR.registrations.map(r => {
    const c = r.contribution;
    let callback = 'undefined';
    if (c.featureId === 'upstream/actions.amazon') {
      const feature = catalog.entries.find(f => f.id === c.featureId)!;
      callback = `amazonCallbacks[${JSON.stringify(String(feature.contributions.findIndex(x => `${c.featureId}#${x.id}` === c.id)))}]`;
    } else if (c.featureId === 'upstream/search-engines.ddg') {
      callback = 'completions.dd.callback';
    } else if (c.kind !== 'map') {
      callback = `allCallbacks[${JSON.stringify(c.featureId)}][${JSON.stringify(c.id.split('#').pop())}]`;
    }

    const rawDesc = c.description;
    const desc = (typeof rawDesc === 'object' && rawDesc !== null)
      ? (rawDesc[p.locale] || rawDesc['en'] || '')
      : (rawDesc ?? '');

    const opts = r.pattern ? `{domain:new RegExp(${JSON.stringify(r.pattern)})}` : '{}';
    if (c.kind === 'map') {
      return `api.map(${JSON.stringify(r.keys[0])},${JSON.stringify(c.target)});`;
    }
    if (c.kind === 'mapkey' || c.kind === 'omnibar') {
      return `api.mapkey(${JSON.stringify(r.keys[0])},${JSON.stringify(desc)},${callback},${opts});`;
    }
    return `api.addSearchAlias(${JSON.stringify(c.alias)},${JSON.stringify(c.name)},${JSON.stringify(c.search)},"",${JSON.stringify(c.compl ?? '')},${callback},undefined,{favicon_url:${JSON.stringify(c.favicon ?? '')},skipMaps:true});\napi.mapkey(${JSON.stringify(r.keys[0])},${JSON.stringify(desc || c.name || '')},()=>api.Front.openOmnibar({type:'SearchEngine',extra:${JSON.stringify(c.alias)}}));\napi.mapkey(${JSON.stringify(r.keys[1])},${JSON.stringify(desc || c.name || '')},()=>api.Clipboard.read(c=>api.Front.openOmnibar({type:'SearchEngine',pref:c.data,extra:${JSON.stringify(c.alias)}})));`;
  });

  const openLinkImpl = hasActions
    ? 'actions.openLink'
    : '(url, opts = {}) => { if (opts.newTab) { if (typeof api !== "undefined" && api.RUNTIME) { api.RUNTIME("openLink", { tab: { tabbed: true, active: opts.active ?? true }, url: url instanceof URL ? url.href : url }); } else if (typeof RUNTIME !== "undefined") { RUNTIME("openLink", { tab: { tabbed: true, active: opts.active ?? true }, url: url instanceof URL ? url.href : url }); } else { window.open(url, "_blank"); } return; } window.location.assign(url); }';

  const searchGroupRuntime = generateSearchGroupRuntime(p, catalog, ctx.root);
  const runtime = `${roots.join('\n')}\nconst allCallbacks=Object.create(null);\nconst factoryResults=[${factories.join(',')}].map(item=>{\n const services=Object.freeze(Object.fromEntries(item.capabilities.map(id=>{\n  if(id==='core.openLink')return ['openLink',${openLinkImpl}];\n  if(id==='core.createHints')return ['createHints',(...args)=>api.Front.createHints(...args)];\n  if(id==='core.clickElement')return ['clickElement',(sel)=>()=>api.Front.clickElement(sel)];\n  if(id==='core.clipboard')return ['clipboard',{read:(cb)=>api.Clipboard.read(cb),write:(t)=>api.Clipboard.write(t)}];\n  if(id==='core.omnibar')return ['omnibar',(opts)=>api.Front.openOmnibar(opts)];\n  if(id==='core.secretStorage')return ['secretStorage',{get:(k)=>k?undefined:{},set:async()=>{}}];\n  throw new Error('Unknown capability: '+id);\n })));\n return {item,returned:item.factory(services)};\n});\nfor(const {item,returned} of factoryResults){\n if(!returned||typeof returned!=='object')throw new Error('Invalid factory result');\n if(Object.getPrototypeOf(returned)!==Object.prototype&&Object.getPrototypeOf(returned)!==null)throw new Error('Invalid factory result prototype');\n const own=Object.getOwnPropertyDescriptors(returned);\n if(!own.callbacks||!('value' in own.callbacks)||!own.callbacks.value||typeof own.callbacks.value!=='object')throw new Error('Invalid callbacks');\n if(Object.getPrototypeOf(own.callbacks.value)!==Object.prototype&&Object.getPrototypeOf(own.callbacks.value)!==null)throw new Error('Invalid callbacks prototype');\n const descriptors=Object.getOwnPropertyDescriptors(own.callbacks.value);\n if(item.required.some(id=>!Object.hasOwn(descriptors,id))||Reflect.ownKeys(descriptors).some(id=>!item.ids.includes(id)||!('value' in descriptors[id])||typeof descriptors[id].value!=='function'))throw new Error('Callback manifest mismatch: '+item.id);\n allCallbacks[item.id]=Object.fromEntries(Reflect.ownKeys(descriptors).map(id=>[id,descriptors[id].value]));\n}\nObject.assign(settings,${JSON.stringify(p.settings)});\n${registrations.join('\n')}\n${searchGroupRuntime}\n`;

  await writeFile(path.join(dir, 'entry.js'), runtime);
  files.push('entry.js');
  return {files: files.sort(), entry: path.join(dir, 'entry.js')};
}
