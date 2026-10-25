#!/usr/bin/env node
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Scan workspace for built profile scripts and configurations.
 */
export async function findBuiltProfiles(workspaceDir = process.cwd()) {
  const wsFile = path.resolve(workspaceDir, 'surfingkeys.workspace.json');
  let outDir = 'dist';
  let profilesDir = 'profiles';

  try {
    const wsRaw = await readFile(wsFile, 'utf8');
    const ws = JSON.parse(wsRaw);
    if (ws.outDir) outDir = ws.outDir;
    if (ws.profilesDir) profilesDir = ws.profilesDir;
  } catch {
    // Default to 'dist' and 'profiles' if workspace file not found or invalid
  }

  const absOutDir = path.resolve(workspaceDir, outDir);
  const absProfilesDir = path.resolve(workspaceDir, profilesDir);

  // Discover candidate profiles from profiles directory
  const profileIds = [];
  try {
    const entries = await readdir(absProfilesDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.json')) {
        try {
          const content = JSON.parse(await readFile(path.join(absProfilesDir, entry.name), 'utf8'));
          if (content && content.id && !content.abstract) {
            profileIds.push(content.id);
          }
        } catch {
          // Ignore invalid profile JSON files
        }
      }
    }
  } catch {
    // If profiles directory doesn't exist, we will search outDir directly
  }

  // Also discover any profiles built in outDir directly
  try {
    const outEntries = await readdir(absOutDir, { withFileTypes: true });
    for (const entry of outEntries) {
      if (entry.isDirectory() && !profileIds.includes(entry.name)) {
        profileIds.push(entry.name);
      }
    }
  } catch {
    // outDir does not exist yet
  }

  const profiles = [];
  for (const id of profileIds.sort()) {
    const targetDir = path.join(absOutDir, id);
    const currentPointer = path.join(targetDir, 'current.json');
    let scriptPath = null;
    let buildId = null;

    try {
      const curData = JSON.parse(await readFile(currentPointer, 'utf8'));
      if (curData && curData.artifacts && curData.artifacts.script) {
        scriptPath = path.join(absOutDir, id, curData.artifacts.script);
        buildId = curData.buildId || null;
      }
    } catch {
      // current.json not present, fallback to checking default filenames
    }

    if (!scriptPath) {
      const standardPath = path.join(targetDir, 'surfingkeys.js');
      try {
        const s = await stat(standardPath);
        if (s.isFile()) {
          scriptPath = standardPath;
        }
      } catch {
        // file doesn't exist
      }
    }

    if (scriptPath) {
      try {
        const content = await readFile(scriptPath, 'utf8');
        profiles.push({
          id,
          scriptPath,
          buildId,
          content
        });
      } catch {
        // unreadable script
      }
    }
  }

  return {
    workspaceDir,
    outDir: absOutDir,
    profilesDir: absProfilesDir,
    profiles
  };
}

/**
 * Generate README content to accompany profiles in the Gist.
 */
export function generateGistReadme({ repoName = 'skcb', profiles = [], gistId = '', owner = '', isPublic = true }) {
  const header = `# SurfingKeys Profiles

Automated build from repository: \`${repoName}\`
Visibility: **${isPublic ? 'Public' : 'Secret (Private)'}**

## Configured Profiles

Load into SurfingKeys (*Settings -> Load settings from*):
`;

  const rows = profiles.map(p => {
    const rawUrl = gistId && owner
      ? `https://gist.githubusercontent.com/${owner}/${gistId}/raw/${p.id}.js`
      : `(Gist Raw URL)/${p.id}.js`;
    return `- **\`${p.id}\`**: [\`${p.id}.js\`](${rawUrl})\n  \`\`\`text\n  ${rawUrl}\n  \`\`\``;
  });

  const footer = `\n---\n*Last updated: ${new Date().toISOString()} by skcb publish-gist workflow*`;

  return `${header}\n${rows.join('\n\n')}\n${footer}\n`;
}

/**
 * Build files map for GitHub Gist API payload.
 */
export function buildGistPayload({ profiles, readme, description, isPublic = true }) {
  const files = {};

  for (const p of profiles) {
    files[`${p.id}.js`] = {
      content: p.content
    };
  }

  if (readme) {
    files['README.md'] = {
      content: readme
    };
  }

  const payload = {
    description,
    files
  };

  if (typeof isPublic === 'boolean') {
    payload.public = isPublic;
  }

  return payload;
}

/**
 * Publish profile files to GitHub Gist using Gist API.
 */
export async function publishToGist({
  token,
  gistId = '',
  description = 'SurfingKeys Config Profiles',
  isPublic = true,
  files = {},
  dryRun = false,
  fetchFn = globalThis.fetch
}) {
  if (dryRun) {
    return {
      success: true,
      dryRun: true,
      gistId: gistId || 'dry-run-gist-id',
      htmlUrl: `https://gist.github.com/dry-run/${gistId || 'dry-run-gist-id'}`,
      isPublic,
      files: Object.keys(files),
      description
    };
  }

  if (!token) {
    throw new Error(
      'GitHub Token is missing. Provide GIST_TOKEN environment variable or pass token option.\n' +
      'Token requires the "gist" scope: https://github.com/settings/tokens'
    );
  }

  const headers = {
    'Accept': 'application/vnd.github+json',
    'Authorization': `Bearer ${token}`,
    'User-Agent': 'skcb-publish-gist',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json'
  };

  let targetGistId = gistId.trim();

  // If no gistId provided, search user's gists for one matching our description
  if (!targetGistId) {
    const listRes = await fetchFn('https://api.github.com/gists?per_page=100', {
      method: 'GET',
      headers
    });

    if (listRes.ok) {
      const gists = await listRes.json();
      const existing = gists.find(g => g.description === description);
      if (existing) {
        targetGistId = existing.id;
      }
    } else if (listRes.status === 401 || listRes.status === 403) {
      const errText = await listRes.text();
      throw new Error(`GitHub API authentication failed (${listRes.status}): ${errText}`);
    }
  }

  if (targetGistId) {
    // Update existing Gist via PATCH
    const patchRes = await fetchFn(`https://api.github.com/gists/${targetGistId}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        description,
        files
      })
    });

    if (!patchRes.ok) {
      const errText = await patchRes.text();
      throw new Error(`Failed to update Gist ${targetGistId} (${patchRes.status}): ${errText}`);
    }

    const gistData = await patchRes.json();
    return {
      success: true,
      updated: true,
      gistId: targetGistId,
      htmlUrl: gistData.html_url,
      owner: gistData.owner ? gistData.owner.login : '',
      isPublic: gistData.public,
      files: Object.keys(gistData.files || files)
    };
  } else {
    // Create new Gist via POST
    const postRes = await fetchFn('https://api.github.com/gists', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        description,
        public: isPublic,
        files
      })
    });

    if (!postRes.ok) {
      const errText = await postRes.text();
      throw new Error(`Failed to create new Gist (${postRes.status}): ${errText}`);
    }

    const gistData = await postRes.json();
    return {
      success: true,
      created: true,
      gistId: gistData.id,
      htmlUrl: gistData.html_url,
      owner: gistData.owner ? gistData.owner.login : '',
      isPublic: gistData.public,
      files: Object.keys(gistData.files || files)
    };
  }
}

/**
 * Main execution function.
 */
export async function main(argv = process.argv.slice(2), env = process.env) {
  let dryRun = env.DRY_RUN === 'true';
  let token = env.GIST_TOKEN || env.GITHUB_TOKEN || '';
  let gistId = env.GIST_ID || '';
  let isPublic = env.GIST_PUBLIC !== 'false';
  let repo = env.GITHUB_REPOSITORY || 'skcb';
  let description = env.GIST_DESCRIPTION || `SurfingKeys Config Profiles (${repo})`;
  let workspaceDir = env.SKCB_WORKSPACE || process.cwd();

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--token' && argv[i + 1]) {
      token = argv[++i];
    } else if (arg === '--gist-id' && argv[i + 1]) {
      gistId = argv[++i];
    } else if (arg === '--public' && argv[i + 1]) {
      isPublic = argv[++i] !== 'false';
    } else if (arg === '--private' || arg === '--secret') {
      isPublic = false;
    } else if (arg === '--desc' && argv[i + 1]) {
      description = argv[++i];
    } else if (arg === '--workspace' && argv[i + 1]) {
      workspaceDir = argv[++i];
    } else if (arg === '-h' || arg === '--help') {
      console.log(`skcb publish-gist - Publish SurfingKeys profile builds to a single GitHub Gist

Usage:
  node scripts/publish-gist.mjs [options]

Options:
  --token <token>       GitHub Personal Access Token with 'gist' scope
  --gist-id <id>        Existing Gist ID to update (optional)
  --public <bool>       Publish as public Gist (default: true)
  --private, --secret   Publish as secret (private) Gist
  --desc <description>  Gist description
  --workspace <path>    Workspace directory (default: current directory)
  --dry-run             Simulate without sending network requests
  -h, --help            Show this help message

Environment Variables:
  GIST_TOKEN / GITHUB_TOKEN   GitHub PAT with gist scope
  GIST_ID                     Existing Gist ID
  GIST_PUBLIC                 'true' (default) or 'false'
  GIST_DESCRIPTION            Gist description
  DRY_RUN                     'true' to simulate
`);
      return 0;
    }
  }

  console.log('🔍 Scanning built profiles in:', workspaceDir);
  const { profiles } = await findBuiltProfiles(workspaceDir);

  if (profiles.length === 0) {
    console.error('⚠️  No built profiles found. Run "npm run build" first to generate dist artifacts.');
    return 1;
  }

  console.log(`📦 Found ${profiles.length} profile(s): ${profiles.map(p => p.id).join(', ')}`);

  const readme = generateGistReadme({
    repoName: repo,
    profiles,
    gistId,
    owner: '',
    isPublic
  });

  const payload = buildGistPayload({
    profiles,
    readme,
    description,
    isPublic
  });

  if (!dryRun && !token) {
    console.error(`\n❌ Error: GIST_TOKEN is not set.`);
    console.error(`To publish profiles to GitHub Gist:`);
    console.error(`  1. Generate a GitHub Personal Access Token (classic) with "gist" scope at:`);
    console.error(`     https://github.com/settings/tokens`);
    console.error(`  2. Set GIST_TOKEN environment variable, or configure it as a GitHub Secret.`);
    console.error(`  Tip: Use --dry-run to test locally without publishing.\n`);
    return 1;
  }

  console.log(`🚀 Publishing ${Object.keys(payload.files).length} file(s) to GitHub Gist (Visibility: ${isPublic ? 'Public' : 'Secret'})...`);

  try {
    const result = await publishToGist({
      token,
      gistId,
      description,
      isPublic,
      files: payload.files,
      dryRun
    });

    console.log('\n✅ Successfully published SurfingKeys profiles to Gist!');
    console.log(`🔗 Gist URL: ${result.htmlUrl}`);
    console.log(`🆔 Gist ID:  ${result.gistId}`);
    if (result.owner) {
      console.log(`👤 Owner:    ${result.owner}`);
    }

    console.log('\n📋 SurfingKeys Raw URLs ("Load settings from"):');
    for (const p of profiles) {
      const rawUrl = result.owner
        ? `https://gist.githubusercontent.com/${result.owner}/${result.gistId}/raw/${p.id}.js`
        : `https://gist.github.com/${result.gistId}#file-${p.id}-js`;
      console.log(`  • ${p.id.padEnd(12)}: ${rawUrl}`);
    }

    if (result.created) {
      console.log('\n💡 Tip: You can save this Gist ID as repository variable GIST_ID to guarantee');
      console.log('   subsequent updates target the same Gist project.');
    }

    return 0;
  } catch (err) {
    console.error(`\n❌ Failed to publish to Gist:`, err.message);
    return 1;
  }
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirectRun) {
  main().then(code => {
    if (code !== 0) process.exit(code);
  });
}
