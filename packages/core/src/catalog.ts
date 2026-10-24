import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import {stat} from 'node:fs/promises';
import {sourceInput, json, fail} from './input.js';
import type {Catalog, Context, Manifest, Feature, Contribution} from './types.js';

export const FIXED_SHA = '80176490f6d04c61d10bcbc20618bd283b94ca23';
export const git = promisify(execFile);

export async function head(root: string): Promise<string> {
  try {
    return (await git('git', ['-C', root, 'rev-parse', 'HEAD'])).stdout.trim();
  } catch {
    fail('SOURCE_GIT_REQUIRED', 'Upstream must be a Git checkout', 3);
  }
}

export async function loadCatalog(ctx: Context): Promise<Catalog> {
  if (ctx.workspace.schemaVersion === 1) {
    if (await head(ctx.upstream) !== FIXED_SHA) {
      fail('ADAPTER_SHA_UNSUPPORTED', `b0o-v1 requires ${FIXED_SHA}`, 3);
    }
  }
  return loadMetadataCatalog(ctx);
}

const KNOWN_CAPABILITIES = new Set([
  'core.openLink',
  'core.createHints',
  'core.clickElement',
  'core.clipboard',
  'core.omnibar',
  'core.secretStorage',
  'core.search'
]);

function isKnownCapability(cap: string): boolean {
  return KNOWN_CAPABILITIES.has(cap) || /^[a-z][a-z0-9_]*\.[A-Za-z0-9]+$/.test(cap);
}

export async function loadMetadataCatalog(ctx: Context): Promise<Catalog> {
  const amazon = [
    ['fakespot', 'fs', 'Fakespot'],
    ['view-product', 'a', 'View product'],
    ['add-to-cart', 'c', 'Add to Cart'],
    ['reviews', 'R', 'View Product Reviews'],
    ['questions', 'Q', 'View Product Q&A'],
    ['account', 'A', 'Open Account page'],
    ['cart', 'C', 'Open Cart page'],
    ['orders', 'O', 'Open Orders page']
  ];
  const entries: Feature[] = [
    {
      id: 'upstream/actions.amazon',
      source: 'upstream',
      entry: 'src/keys.js',
      description: 'Amazon site functionality',
      requires: [],
      capabilities: ['core.openLink'],
      contributions: amazon.map(([id, alias, description]) => ({
        id,
        alias,
        description,
        kind: 'mapkey',
        domain: 'amazon.com',
        callbackRequired: true
      }))
    },
    {
      id: 'upstream/search-engines.ddg',
      source: 'upstream',
      entry: 'src/search-engines.js',
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
          callbackRequired: true
        }
      ]
    }
  ];

  const namespaces = new Set(['upstream', 'core']);
  for (let i = 0; i < ctx.extensions.length; i++) {
    const root = ctx.extensions[i];
    const manifestFile = await sourceInput(root, 'selective.json');
    const manifest = await json<Manifest>(manifestFile, 'manifest');
    if (namespaces.has(manifest.namespace)) {
      fail('NAMESPACE_DUPLICATE', `Duplicate namespace ${manifest.namespace}`);
    }
    namespaces.add(manifest.namespace);
    for (const [local, entry] of Object.entries(manifest.entries)) {
      const entryFile = await sourceInput(root, entry.entry);
      if (!(await stat(entryFile)).isFile()) {
        fail('ENTRY_INVALID', 'Extension entry must be a regular file');
      }
      const ids = new Set<string>();
      for (const contribution of entry.contributions) {
        if (ids.has(contribution.id)) {
          fail('CONTRIBUTION_DUPLICATE', `Duplicate contribution ${contribution.id}`);
        }
        ids.add(contribution.id);
      }
      entries.push({
        ...entry,
        id: `${manifest.namespace}/${local}`,
        source: path.relative(ctx.root, root).split(path.sep).join('/')
      });
      if (manifest.namespace === 'b0o') {
        const upstreamAlias = `upstream/${local}`;
        const existingIdx = entries.findIndex(e => e.id === upstreamAlias);
        const aliasedEntry = {
          ...entry,
          id: upstreamAlias,
          source: path.relative(ctx.root, root).split(path.sep).join('/')
        };
        if (existingIdx >= 0) {
          entries[existingIdx] = aliasedEntry;
        } else {
          entries.push(aliasedEntry);
        }
      }
    }
  }

  const index = new Map(entries.map(entry => [entry.id, entry]));
  const visiting = new Set<string>();
  const done = new Set<string>();

  function visit(id: string): void {
    if (visiting.has(id)) {
      fail('FEATURE_CYCLE', `Feature dependency cycle at ${id}`);
    }
    if (done.has(id)) { return; }
    const entry = index.get(id);
    if (!entry) {
      fail('FEATURE_UNKNOWN', `Unknown feature ${id}`);
    }
    visiting.add(id);
    for (const capability of entry.capabilities ?? []) {
      if (!isKnownCapability(capability)) {
        fail('CAPABILITY_UNKNOWN', `Unknown capability ${capability}`);
      }
    }
    for (const dependency of entry.requires ?? []) {
      visit(dependency);
    }
    visiting.delete(id);
    done.add(id);
  }

  for (const entry of entries) {
    visit(entry.id);
  }

  return {
    entries,
    capabilities: {
      'core.openLink': {
        contract: 'openLink(url, {newTab?, active?})',
        implementation: 'src/actions.js#actions.openLink',
        apiDependencies: ['RUNTIME'],
        codeAnalysis: 'pending'
      },
      'core.createHints': {
        contract: 'createHints(selector, callback)',
        implementation: 'api.Front.createHints'
      },
      'core.clickElement': {
        contract: 'clickElement(selector)',
        implementation: 'api.Front.clickElement'
      },
      'core.clipboard': {
        contract: 'clipboard(text)',
        implementation: 'api.Clipboard'
      },
      'core.omnibar': {
        contract: 'omnibar(options)',
        implementation: 'api.Front.openOmnibar'
      },
      'core.secretStorage': {
        contract: 'secretStorage.get/set',
        implementation: 'core.secretStorage'
      }
    },
    unsupported: [{ id: 'upstream/*', reason: 'Only Amazon and DDG metadata supported; source shape analysis pending' }],
    codeAnalysis: 'pending'
  };
}

export function selection(select: string[], catalog: Catalog): {
  resolvedFeatures: string[];
  reasons: {featureId: string; requiredBy: string}[];
  contributions: (Contribution & {id: string; featureId: string})[];
  resolvedCapabilities: string[];
  capabilityReasons: {capabilityId: string; requiredBy: string}[];
} {
  const index = new Map(catalog.entries.map(entry => [entry.id, entry]));
  const resolvedFeatures: string[] = [];
  const reasons: {featureId: string; requiredBy: string}[] = [];

  function visit(id: string, requiredBy: string): void {
    reasons.push({featureId: id, requiredBy});
    if (resolvedFeatures.includes(id)) { return; }
    const entry = index.get(id);
    if (!entry) {
      fail('FEATURE_UNKNOWN', `Unknown feature ${id}`);
    }
    resolvedFeatures.push(id);
    for (const dependency of entry.requires ?? []) {
      visit(dependency, id);
    }
  }

  for (const id of select) {
    visit(id, 'profile');
  }

  const contributions = resolvedFeatures.flatMap(id =>
    index.get(id)!.contributions.map(c => ({...c, id: `${id}#${c.id}`, featureId: id}))
  );
  const resolvedCapabilities = [...new Set(resolvedFeatures.flatMap(id => index.get(id)!.capabilities ?? []))];
  const capabilityReasons = resolvedFeatures.flatMap(id =>
    (index.get(id)!.capabilities ?? []).map(capabilityId => ({capabilityId, requiredBy: id}))
  );

  return {resolvedFeatures, reasons, contributions, resolvedCapabilities, capabilityReasons};
}
