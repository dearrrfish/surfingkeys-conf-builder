import {readdir, readFile, writeFile, mkdir, rename, rm, stat, lstat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {workspace, loadMetadataCatalog, inside, contained, privatePath, json, fail, Failure} from '@skcb/core';
import type {Catalog, Profile} from '@skcb/core';

export interface StaticExportOptions {
  workspacePath?: string;
  outDir: string;
  repository?: string;
  baseBranch?: string;
  catalog?: Catalog;
  profiles?: StaticProfileMetadata[];
  now?: string;
}

export interface StaticProfileMetadata {
  id: string;
  abstract: boolean;
  extends?: string;
  locale?: string;
  file: string;
}

export interface StaticExportResult {
  outDir: string;
  files: string[];
  manifest: {
    generator: 'skcb-static';
    schemaVersion: 1;
    generatedAt: string;
    repository?: string;
    baseBranch: string;
    catalogEntries: number;
    profiles: StaticProfileMetadata[];
  };
}

function sanitizeCatalog(cat: Catalog, workspaceRoot: string): Catalog {
  return {
    ...cat,
    entries: cat.entries.map(e => {
      let src = e.source || '';
      if (path.isAbsolute(src)) {
        src = path.relative(workspaceRoot, src).split(path.sep).join('/');
      }
      if (src.includes(workspaceRoot)) {
        src = src.split(workspaceRoot).join('.');
      }
      return {
        ...e,
        source: src
      };
    })
  };
}

export async function exportStaticSite(options: StaticExportOptions): Promise<StaticExportResult> {
  if (!options.outDir || typeof options.outDir !== 'string' || !options.outDir.trim()) {
    fail('OUTPUT_PATH_INVALID', 'Output directory is required');
  }

  if (privatePath(options.outDir)) {
    fail('OUTPUT_PATH_INVALID', 'Output path cannot target private path');
  }

  const resolvedOutDir = path.resolve(process.cwd(), options.outDir);
  const ctx = await workspace(options.workspacePath ?? 'surfingkeys.workspace.json');

  if (resolvedOutDir === ctx.root || contained(resolvedOutDir, ctx.root)) {
    fail('OUTPUT_PATH_INVALID', 'Output path cannot equal or contain workspace root');
  }

  if (contained(ctx.profilesDir, resolvedOutDir)) {
    fail('OUTPUT_PATH_INVALID', 'Output path cannot be inside profiles directory');
  }

  const sourceRoots = [ctx.upstream, ...ctx.extensions].filter(Boolean);
  for (const src of sourceRoots) {
    if (contained(src, resolvedOutDir)) {
      fail('OUTPUT_PATH_INVALID', `Output path cannot be inside source root: ${src}`);
    }
  }

  // Symlink check on all ancestors and target
  let curr = resolvedOutDir;
  while (true) {
    try {
      const s = await lstat(curr);
      if (s.isSymbolicLink()) {
        fail('OUTPUT_PATH_INVALID', `Output path or ancestor is a symlink: ${curr}`);
      }
    } catch (err: any) {
      if (err.code !== 'ENOENT') throw err;
    }
    const parent = path.dirname(curr);
    if (parent === curr) break;
    curr = parent;
  }

  // Check if outDir exists and is safe to overwrite
  let outExists = false;
  try {
    const st = await stat(resolvedOutDir);
    outExists = true;
    if (!st.isDirectory()) {
      fail('OUTPUT_PATH_INVALID', 'Output path exists and is not a directory');
    }
    const entries = await readdir(resolvedOutDir);
    if (entries.length > 0) {
      const manifestPath = path.join(resolvedOutDir, 'manifest.json');
      let valid = false;
      try {
        const raw = await readFile(manifestPath, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && parsed.generator === 'skcb-static') {
          valid = true;
        }
      } catch {
        valid = false;
      }
      if (!valid) {
        fail('OUTPUT_PATH_INVALID', 'Refusing to overwrite non-skcb-static directory');
      }
    }
  } catch (err: any) {
    if (err instanceof Failure) throw err;
    if (err.code !== 'ENOENT') throw err;
  }

  // Profiles metadata
  let profiles: StaticProfileMetadata[];
  if (options.profiles) {
    profiles = options.profiles;
  } else {
    const profileList: StaticProfileMetadata[] = [];
    const ids = new Set<string>();

    async function scanProfiles(dir: string): Promise<void> {
      const items = await readdir(dir, {withFileTypes: true});
      for (const item of items) {
        const relative = path.relative(ctx.profilesDir, path.join(dir, item.name));
        const file = await inside(ctx.profilesDir, relative);
        if (item.isDirectory()) {
          await scanProfiles(file);
        } else if (item.name.endsWith('.json')) {
          const p = await json<Profile>(file, 'profile');
          if (ids.has(p.id)) {
            fail('PROFILE_DUPLICATE', `Duplicate profile id ${p.id}`);
          }
          ids.add(p.id);
          const repoRelativeFile = path.relative(ctx.root, file).split(path.sep).join('/');
          profileList.push({
            id: p.id,
            abstract: Boolean(p.abstract),
            ...(p.extends ? {extends: p.extends} : {}),
            ...(p.locale ? {locale: p.locale} : {}),
            file: repoRelativeFile
          });
        }
      }
    }

    await scanProfiles(ctx.profilesDir);
    profileList.sort((a, b) => a.id.localeCompare(b.id));
    profiles = profileList;
  }

  // Catalog
  const rawCatalog = options.catalog ?? (await loadMetadataCatalog(ctx));
  const sanitizedCatalog = sanitizeCatalog(rawCatalog, ctx.root);

  // Template HTML
  const projectRoot = fileURLToPath(new URL('../', import.meta.url));
  const templatePath = path.join(projectRoot, 'ui', 'index.html');
  const template = await readFile(templatePath, 'utf8');

  const marker = '<script id="skcb-static-config" type="application/json">{}</script>';
  if (!template.includes(marker)) {
    fail('TEMPLATE_INVALID', 'Static config marker not found in index.html');
  }

  const now = options.now ?? new Date().toISOString();
  const repository = options.repository || process.env.GITHUB_REPOSITORY;
  const baseBranch = options.baseBranch || process.env.GITHUB_REF_NAME || 'main';

  const staticConfig = {
    schemaVersion: 1,
    mode: 'static',
    generator: 'skcb-static',
    generatedAt: now,
    ...(repository ? {repository} : {}),
    baseBranch,
    catalog: 'data/catalog.json',
    profiles: 'data/profiles.json'
  };

  const escapedConfig = JSON.stringify(staticConfig, null, 2).replace(/</g, '\\u003c');
  const injectedHtml = template.replace(
    marker,
    `<script id="skcb-static-config" type="application/json">${escapedConfig}</script>`
  );

  const manifest = {
    generator: 'skcb-static' as const,
    schemaVersion: 1 as const,
    generatedAt: now,
    ...(repository ? {repository} : {}),
    baseBranch,
    catalogEntries: sanitizedCatalog.entries.length,
    profiles
  };

  // Atomic output write
  const tmpDir = `${resolvedOutDir}.tmp-${process.pid}-${Date.now()}`;
  await rm(tmpDir, {recursive: true, force: true}).catch(() => {});
  await mkdir(tmpDir, {recursive: true});

  try {
    await mkdir(path.join(tmpDir, 'data'), {recursive: true});
    await writeFile(path.join(tmpDir, '.nojekyll'), '');
    await writeFile(path.join(tmpDir, 'index.html'), injectedHtml, 'utf8');
    await writeFile(
      path.join(tmpDir, 'data', 'catalog.json'),
      JSON.stringify({schemaVersion: 1, catalog: sanitizedCatalog}, null, 2) + '\n',
      'utf8'
    );
    await writeFile(
      path.join(tmpDir, 'data', 'profiles.json'),
      JSON.stringify({schemaVersion: 1, profiles}, null, 2) + '\n',
      'utf8'
    );
    await writeFile(
      path.join(tmpDir, 'manifest.json'),
      JSON.stringify(manifest, null, 2) + '\n',
      'utf8'
    );

    if (outExists) {
      const bakDir = `${resolvedOutDir}.bak-${process.pid}-${Date.now()}`;
      await rename(resolvedOutDir, bakDir);
      try {
        await rename(tmpDir, resolvedOutDir);
        await rm(bakDir, {recursive: true, force: true});
      } catch (swapErr) {
        try {
          await rename(bakDir, resolvedOutDir);
        } catch {}
        throw swapErr;
      }
    } else {
      await mkdir(path.dirname(resolvedOutDir), {recursive: true});
      await rename(tmpDir, resolvedOutDir);
    }
  } catch (err) {
    await rm(tmpDir, {recursive: true, force: true}).catch(() => {});
    throw err;
  }

  return {
    outDir: resolvedOutDir,
    files: ['.nojekyll', 'data/catalog.json', 'data/profiles.json', 'index.html', 'manifest.json'],
    manifest
  };
}
