#!/usr/bin/env node
import path from 'node:path';
import { stat } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import {
  workspace,
  loadMetadataCatalog,
  profileIds,
  resolveProfile,
  explain,
  Failure
} from '@skcb/core';

/**
 * Validate all buildable profiles in a workspace.
 *
 * @param {object} options
 * @param {string} [options.workspacePath='surfingkeys.workspace.json']
 * @returns {Promise<{ ok: boolean, profiles: string[], diagnostics: Array<{ profileId?: string, code: string, message: string, file?: string }> }>}
 */
export async function validateProfiles(options = {}) {
  let workspacePath = options.workspacePath || 'surfingkeys.workspace.json';
  try {
    const st = await stat(workspacePath);
    if (st.isDirectory()) {
      workspacePath = path.join(workspacePath, 'surfingkeys.workspace.json');
    }
  } catch {
    // Keep workspacePath as-is if stat fails; workspace() will fail with WORKSPACE_MISSING
  }

  const diagnostics = [];
  const validProfileIds = [];

  let ctx;
  let catalog;
  let ids;

  try {
    ctx = await workspace(workspacePath);
    catalog = await loadMetadataCatalog(ctx);
    ids = await profileIds(workspacePath);
  } catch (err) {
    const code = (err instanceof Failure || err?.diagnostic)
      ? (err.diagnostic?.code || 'VALIDATION_FAILED')
      : (err.code || 'VALIDATION_FAILED');
    const message = err?.diagnostic?.message || err?.message || String(err);
    diagnostics.push({
      code,
      message,
      ...(err?.diagnostic?.file ? { file: err.diagnostic.file } : {})
    });
    return {
      ok: false,
      profiles: [],
      diagnostics
    };
  }

  for (const id of ids) {
    try {
      const resolved = await resolveProfile(ctx, id, catalog);
      explain(resolved, catalog);
      validProfileIds.push(id);
    } catch (err) {
      const code = (err instanceof Failure || err?.diagnostic)
        ? (err.diagnostic?.code || 'VALIDATION_FAILED')
        : (err.code || 'VALIDATION_FAILED');
      const message = err?.diagnostic?.message || err?.message || String(err);
      diagnostics.push({
        profileId: id,
        code,
        message,
        ...(err?.diagnostic?.file ? { file: err.diagnostic.file } : {})
      });
    }
  }

  return {
    ok: diagnostics.length === 0,
    profiles: validProfileIds,
    diagnostics
  };
}

/**
 * CLI entrypoint.
 *
 * @param {string[]} [argv=process.argv.slice(2)]
 * @returns {Promise<number>}
 */
export async function main(argv = process.argv.slice(2)) {
  let workspacePath = 'surfingkeys.workspace.json';
  let jsonOutput = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--workspace' && i + 1 < argv.length) {
      workspacePath = argv[++i];
    } else if (arg === '--json') {
      jsonOutput = true;
    } else if (arg === '-h' || arg === '--help') {
      console.log('Usage: node scripts/validate-profiles.mjs [--workspace <path>] [--json]');
      return 0;
    }
  }

  const result = await validateProfiles({ workspacePath });
  if (jsonOutput) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    if (result.ok) {
      console.log(`✓ All ${result.profiles.length} profile(s) validated successfully: ${result.profiles.join(', ')}`);
    } else {
      console.error(`✗ Profile validation failed with ${result.diagnostics.length} diagnostic(s):`);
      for (const diag of result.diagnostics) {
        const prefix = diag.profileId ? `[${diag.profileId}] ` : '';
        console.error(`  - ${prefix}${diag.code}: ${diag.message}`);
      }
    }
  }

  return result.ok ? 0 : 1;
}

const isDirectRun = process.argv[1] && (
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href ||
  import.meta.url === pathToFileURL(process.argv[1]).href
);
if (isDirectRun) {
  main().then(code => {
    if (code !== 0) {
      process.exitCode = code;
    }
  });
}
