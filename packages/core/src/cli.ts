#!/usr/bin/env node
import {pathToFileURL} from 'node:url';
import {realpath} from 'node:fs/promises';
import {workspace, fail, Failure} from './input.js';
import {loadCatalog} from './catalog.js';
import {analyzeConfiguration, buildWithSelectives, profileIds, compare} from './build.js';
import {refresh, verifySources} from './sources.js';

export async function run(args: string[]): Promise<{exitCode: number; output: unknown}> {
  try {
    if (args.length === 1 && args[0] === '--help') {
      return {
        exitCode: 0,
        output: {
          commands: [
            'catalog',
            'validate --profile <id>',
            'explain --profile <id>',
            'sources lock --refresh',
            'build --profile <id> | --all [--auto-lock]',
            'compare --profile <id> --against <buildId>'
          ],
          options: ['--workspace <path>', '--json', '--auto-lock'],
          validationLevels: {catalog: 'catalogMetadata', validate: 'sourceAnalysis', explain: 'sourceAnalysis'},
          codeAnalysis: {catalog: 'pending', validate: 'complete', explain: 'complete'}
        }
      };
    }
    let workspaceFile = 'surfingkeys.workspace.json';
    let profileId: string | undefined;
    let isRefresh = false;
    let all = false;
    let autoLock = false;
    let mode: 'production' | 'development' = 'production';
    let against: string | undefined;
    const positional: string[] = [];
    const flags = new Set<string>();

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg.startsWith('--')) {
        if (flags.has(arg)) {
          fail('CLI_USAGE', `Duplicate option ${arg}`);
        }
        flags.add(arg);
        if (['--workspace', '--profile', '--mode', '--against'].includes(arg)) {
          const value = args[++i];
          if (!value || value.startsWith('--')) {
            fail('CLI_USAGE', `Missing value for ${arg}`);
          }
          if (arg === '--workspace') {
            workspaceFile = value;
          } else if (arg === '--profile') {
            profileId = value;
          } else if (arg === '--against') {
            against = value;
          } else {
            if (value !== 'production' && value !== 'development') {
              fail('CLI_USAGE', 'Invalid build mode');
            }
            mode = value;
          }
        } else if (arg === '--all') {
          all = true;
        } else if (arg === '--refresh') {
          isRefresh = true;
        } else if (arg === '--auto-lock') {
          autoLock = true;
        } else if (arg !== '--json') {
          fail('CLI_USAGE', `Unknown option ${arg}`);
        }
      } else {
        positional.push(arg);
      }
    }

    const command = positional.join(' ');
    if (!['catalog', 'validate', 'explain', 'sources lock', 'build', 'compare'].includes(command)) {
      fail('CLI_USAGE', 'Supported commands: catalog, validate, explain, sources lock --refresh');
    }
    if ((isRefresh && command !== 'sources lock') || (profileId && (command === 'catalog' || command === 'sources lock'))) {
      fail('CLI_USAGE', 'Option is not valid for this command');
    }
    if (((all || flags.has('--mode') || autoLock) && command !== 'build') || (against && command !== 'compare') || (all && profileId)) {
      fail('CLI_USAGE', 'Option is not valid for command');
    }

    const ctx = await workspace(workspaceFile);

    if (command === 'build') {
      if (!all && !profileId) {
        fail('CLI_USAGE', 'build requires --profile or --all');
      }
      if (!all) {
        return {exitCode: 0, output: await buildWithSelectives({workspacePath: workspaceFile, profileId: profileId!, mode, autoLock})};
      }
      await loadCatalog(ctx);
      await verifySources(ctx, autoLock);
      const results = [];
      let exitCode = 0;
      for (const id of await profileIds(workspaceFile)) {
        try {
          results.push(await buildWithSelectives({workspacePath: workspaceFile, profileId: id, mode, autoLock}));
        } catch (error) {
          exitCode = error instanceof Failure ? Math.max(exitCode, error.exitCode) : 4;
          results.push({
            ok: false,
            profileId: id,
            diagnostics: [error instanceof Failure ? error.diagnostic : {code: 'TOOLCHAIN_FAILURE', message: String(error)}]
          });
        }
      }
      return {exitCode, output: {ok: exitCode === 0, results}};
    }

    if (command === 'compare') {
      if (!profileId || !against) {
        fail('CLI_USAGE', 'compare requires --profile and --against');
      }
      return {exitCode: 0, output: await compare(workspaceFile, profileId, against)};
    }

    if (command === 'sources lock') {
      if (!isRefresh) {
        fail('CLI_USAGE', 'sources lock requires --refresh');
      }
      return {exitCode: 0, output: {ok: true, lock: await refresh(ctx)}};
    }

    const catalog = await loadCatalog(ctx);
    if (command === 'catalog') {
      return {exitCode: 0, output: {ok: true, catalog, sourceLockValidation: 'notPerformed', validationLevel: 'catalogMetadata', buildReady: false}};
    }
    if (!profileId) {
      fail('CLI_USAGE', '--profile is required');
    }
    const result = await analyzeConfiguration(workspaceFile, profileId);
    return {exitCode: 0, output: {ok: true, sourceLockValidation: 'verified', ...(result as object)}};
  } catch (error) {
    if (error instanceof Failure) {
      return {exitCode: error.exitCode, output: {ok: false, diagnostics: [error.diagnostic]}};
    }
    return {
      exitCode: 4,
      output: {
        ok: false,
        diagnostics: [{code: 'TOOLCHAIN_FAILURE', phase: 'toolchain', message: error instanceof Error ? error.message : 'Unexpected toolchain failure', causes: []}]
      }
    };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(await realpath(process.argv[1])).href) {
  const result = await run(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(result.output, null, 2)}\n`);
  process.exitCode = result.exitCode;
}
