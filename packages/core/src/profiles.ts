import {readdir} from 'node:fs/promises';
import path from 'node:path';
import {inside, json, fail} from './input.js';
import {registrationConflict, registrationPlan} from './registration.js';
import {selection} from './catalog.js';
import type {Catalog, Context, Profile, EffectiveProfile} from './types.js';

export async function resolveProfile(ctx: Context, id: string, catalog: Catalog): Promise<EffectiveProfile> {
  const files = new Map<string, Profile>();
  const ids = new Map<string, string>();

  async function scan(dir: string): Promise<void> {
    for (const item of await readdir(dir, {withFileTypes: true})) {
      const relative = path.relative(ctx.profilesDir, path.join(dir, item.name));
      const file = await inside(ctx.profilesDir, relative);
      if (item.isDirectory()) {
        await scan(file);
      } else if (item.name.endsWith('.json')) {
        const p = await json<Profile>(file, 'profile');
        if (ids.has(p.id)) {
          fail('PROFILE_DUPLICATE', `Duplicate profile id ${p.id}`);
        }
        ids.set(p.id, file);
        files.set(file, p);
      }
    }
  }

  await scan(ctx.profilesDir);
  const target = ids.get(id);
  if (!target) {
    fail('PROFILE_UNKNOWN', `Unknown profile ${id}`);
  }

  const visited = new Set<string>();
  const chain: {file: string; p: Profile}[] = [];

  async function parent(file: string): Promise<void> {
    if (visited.has(file)) {
      fail('PROFILE_CYCLE', 'Profile inheritance cycle');
    }
    visited.add(file);
    const p = files.get(file);
    if (!p) {
      fail('PARENT_UNDECLARED', 'Parent must be an indexed profile JSON');
    }
    if (p.extends) {
      const rootRelative = path.relative(ctx.profilesDir, path.resolve(path.dirname(file), p.extends));
      if (path.isAbsolute(p.extends)) {
        fail('PATH_INVALID', 'Parent path must be relative');
      }
      await parent(await inside(ctx.profilesDir, rootRelative));
    }
    chain.push({file, p});
  }

  await parent(target);

  const targetProfile = files.get(target)!;
  const result: EffectiveProfile = {
    id,
    locale: targetProfile.locale || 'zh-CN',
    abstract: targetProfile.abstract ?? false,
    base: 'minimal',
    select: [],
    selectRemoveContributions: [],
    conflictResolution: {
      mode: 'strict',
      modulePrecedence: []
    },
    settings: {},
    leaders: {site: '<Space>', search: 'a'},
    overrides: [],
    provenance: {
      base: 'base:minimal',
      'leaders.site': 'base:minimal',
      'leaders.search': 'base:minimal'
    }
  };

  const available = new Set(catalog.entries.map(e => e.id));

  for (const {file, p} of chain) {
    const origin = path.relative(ctx.root, file).split(path.sep).join('/');
    if (p.base) {
      result.base = p.base;
      result.provenance.base = origin;
    }
    if (p.locale) {
      result.locale = p.locale;
      result.provenance.locale = origin;
    }
    if (p.selectRemoveContributions) {
      for (const contribId of p.selectRemoveContributions) {
        if (!result.selectRemoveContributions.includes(contribId)) {
          result.selectRemoveContributions.push(contribId);
          result.provenance[`selectRemoveContributions.${contribId}`] = origin;
        }
      }
    }
    if (p.conflictResolution) {
      if (p.conflictResolution.mode) {
        result.conflictResolution.mode = p.conflictResolution.mode;
        result.provenance['conflictResolution.mode'] = origin;
      }
      if (p.conflictResolution.modulePrecedence) {
        result.conflictResolution.modulePrecedence = [...p.conflictResolution.modulePrecedence];
        result.provenance['conflictResolution.modulePrecedence'] = origin;
      }
    }
    for (const feature of [...(p.selectAdd ?? []), ...(p.selectRemove ?? [])]) {
      if (!available.has(feature)) {
        fail('FEATURE_UNKNOWN', `Unknown feature ${feature}`);
      }
    }
    for (const feature of p.selectAdd ?? []) {
      if (p.selectRemove?.includes(feature)) {
        fail('SELECT_OVERLAP', `Feature added and removed: ${feature}`);
      }
      if (!result.select.includes(feature)) {
        result.select.push(feature);
        result.provenance[`select.${feature}`] = origin;
        delete result.provenance[`removed.${feature}`];
      }
    }
    for (const feature of p.selectRemove ?? []) {
      if (!result.select.includes(feature)) {
        fail('SELECT_REMOVE_MISSING', `Cannot remove absent feature ${feature}`);
      }
      result.select = result.select.filter(item => item !== feature);
      result.provenance[`removed.${feature}`] = origin;
      delete result.provenance[`select.${feature}`];
    }
    for (const key of p.unsetSettings ?? []) {
      if (Object.hasOwn(p.settings ?? {}, key)) {
        fail('SETTINGS_OVERLAP', `Setting both set and unset: ${key}`);
      }
      if (!Object.hasOwn(result.settings, key)) {
        fail('SETTING_UNSET_MISSING', `Cannot unset absent setting ${key}`);
      }
      delete result.settings[key];
      delete result.provenance[`settings.${key}`];
      result.provenance[`unsetSettings.${key}`] = origin;
    }
    for (const [key, value] of Object.entries(p.settings ?? {})) {
      Object.defineProperty(result.settings, key, {value, writable: true, enumerable: true, configurable: true});
      result.provenance[`settings.${key}`] = origin;
      delete result.provenance[`unsetSettings.${key}`];
    }
    for (const [key, value] of Object.entries(p.leaders ?? {})) {
      result.leaders[key as 'site' | 'search'] = value;
      result.provenance[`leaders.${key}`] = origin;
    }
    if (p.keybindings) {
      result.keybindings = {...(result.keybindings ?? {}), ...p.keybindings};
      for (const k of Object.keys(p.keybindings)) {
        result.provenance[`keybindings.${k}`] = origin;
      }
    }
    if (p.overrides) {
      result.overrides = p.overrides;
      result.provenance.overrides = origin;
    }
    if (p.searchGroups) {
      if (!result.searchGroups) result.searchGroups = [];
      for (const group of p.searchGroups) {
        const existingIdx = result.searchGroups.findIndex(g => g.id === group.id);
        if (existingIdx >= 0) {
          result.searchGroups[existingIdx] = group;
        } else {
          result.searchGroups.push(group);
        }
      }
      result.provenance.searchGroups = origin;
    }
  }

  if (result.base !== 'minimal') {
    fail('BASE_UNSUPPORTED', 'Only minimal base is supported');
  }

  return result;
}

export function explain(profile: EffectiveProfile, catalog: Catalog): unknown {
  const selected = selection(profile.select, catalog);
  const unremovedContribs = selected.contributions
    .filter(c => !profile.selectRemoveContributions.includes(c.id))
    .map(c => {
      if (profile.keybindings && profile.keybindings[c.id]) {
        return {...c, alias: profile.keybindings[c.id]};
      }
      return c;
    });
  const index = new Map(unremovedContribs.map(c => [c.id, c]));
  const targets = new Set<string>();
  const replacements = new Set<string>();

  for (const override of profile.overrides) {
    const target = index.get(override.target);
    const replacement = index.get(override.with);
    if (!target || !replacement) {
      fail('OVERRIDE_UNKNOWN', 'Override sides must belong to selected feature closure');
    }
    if (override.target === override.with || targets.has(override.target) || replacements.has(override.with)) {
      fail('OVERRIDE_INVALID', 'Override must be unique and cannot target itself');
    }
    if (target.kind !== replacement.kind) {
      fail('OVERRIDE_KIND', 'Override contribution kinds must match');
    }
    if (!registrationConflict(target, replacement, profile)) {
      fail('OVERRIDE_NO_CONFLICT', 'Override target must conflict with replacement');
    }
    targets.add(override.target);
    replacements.add(override.with);
  }

  for (const override of profile.overrides) {
    const seen = new Set<string>();
    let current = override.target;
    while (targets.has(current)) {
      if (seen.has(current)) {
        fail('OVERRIDE_CYCLE', 'Override cycle');
      }
      seen.add(current);
      current = profile.overrides.find(o => o.target === current)!.with;
    }
  }

  let contributions = unremovedContribs.filter(c => !targets.has(c.id));

  // Multi-library conflict auto-resolution (mode: module-precedence | prefer-later)
  if (profile.conflictResolution.mode === 'module-precedence' || profile.conflictResolution.mode === 'prefer-later') {
    const mode = profile.conflictResolution.mode;
    const prec = profile.conflictResolution.modulePrecedence || [];
    const suppressedByPrecedence = new Set<string>();
    for (let i = 0; i < contributions.length; i++) {
      for (let j = i + 1; j < contributions.length; j++) {
        const a = contributions[i];
        const b = contributions[j];
        if (suppressedByPrecedence.has(a.id) || suppressedByPrecedence.has(b.id)) continue;
        if (registrationConflict(a, b, profile)) {
          let winner = a;
          let loser = b;
          if (mode === 'module-precedence') {
            const modA = a.featureId.split('/')[0];
            const modB = b.featureId.split('/')[0];
            const idxA = prec.indexOf(modA);
            const idxB = prec.indexOf(modB);
            const rankA = idxA === -1 ? 999 : idxA;
            const rankB = idxB === -1 ? 999 : idxB;
            if (rankB < rankA) {
              winner = b;
              loser = a;
            }
          } else {
            const idxA = profile.select.indexOf(a.featureId);
            const idxB = profile.select.indexOf(b.featureId);
            if (idxB > idxA) {
              winner = b;
              loser = a;
            }
          }
          suppressedByPrecedence.add(loser.id);
          targets.add(loser.id);
        }
      }
    }
    contributions = contributions.filter(c => !suppressedByPrecedence.has(c.id));
  }

  const defaultSearch = profile.settings.defaultSearchEngine;
  if (defaultSearch !== undefined && (typeof defaultSearch !== 'string' || !contributions.some(c => c.kind === 'search' && c.alias === defaultSearch))) {
    fail('DEFAULT_SEARCH_UNKNOWN', 'defaultSearchEngine must match an active search contribution');
  }

  const registrationIR = registrationPlan(contributions, profile);
  return {
    registrationIR,
    validationLevel: 'staticConfiguration',
    codeAnalysis: 'pending',
    registrationConflictChecks: 'complete',
    buildReady: false,
    profile,
    requested: profile.select,
    ...selected,
    contributions,
    suppressedContributions: [...targets],
    removedContributions: [...profile.selectRemoveContributions],
    retainedSymbols: {status: 'pending'},
    pending: ['upstream source shape analysis', 'transitive import analysis', 'registration conflict analysis']
  };
}
