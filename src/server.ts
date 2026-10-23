#!/usr/bin/env node
import http from 'node:http';
import {readFile, readdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import AjvModule from 'ajv';
import {workspace, inside, Failure} from './input.js';
import {loadMetadataCatalog} from './catalog.js';
import {explain} from './profiles.js';
import {buildWithSelectives} from './build.js';
import type {Context, Profile} from './types.js';

const Ajv = AjvModule.default;
const ajv = new Ajv({allErrors: true, strict: false});

export interface ServerOptions {
  workspacePath?: string;
  port?: number;
  host?: string;
  uiDir?: string;
}

export async function createVisualServer(options: ServerOptions = {}) {
  const workspacePath = options.workspacePath ?? 'surfingkeys.workspace.json';
  const port = options.port ?? Number(process.env.PORT || 3000);
  const host = options.host ?? (process.env.HOST || '127.0.0.1');
  const projectRoot = fileURLToPath(new URL('../', import.meta.url));
  const uiDir = options.uiDir ?? path.join(projectRoot, 'ui');

  const profileSchemaPath = fileURLToPath(new URL('../schemas/profile.schema.json', import.meta.url));
  const profileSchema = JSON.parse(await readFile(profileSchemaPath, 'utf8'));
  const profileValidator = ajv.compile(profileSchema);

  async function getContext(): Promise<Context> {
    return workspace(workspacePath);
  }

  const server = http.createServer(async (req, res) => {
    // Enable CORS for local testing
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const parsedUrl = new URL(req.url ?? '/', `http://${host}:${port}`);
    const pathname = parsedUrl.pathname;

    try {
      // API: GET /script/:id (Serve raw surfingkeys.js for SurfingKeys "Load settings from" feature)
      const scriptDirectMatch = pathname.match(/^\/script\/([^/]+)$/);
      if (req.method === 'GET' && scriptDirectMatch) {
        const id = decodeURIComponent(scriptDirectMatch[1]);
        try {
          const ctx = await getContext();
          const currentPointerPath = path.join(ctx.outDir, id, 'current.json');
          let scriptFile: string | null = null;
          try {
            const curRaw = await readFile(currentPointerPath, 'utf8');
            const cur = JSON.parse(curRaw);
            scriptFile = path.join(ctx.outDir, id, cur.artifacts.script);
          } catch {
            const buildRes = await buildWithSelectives({
              workspacePath: ctx.file,
              profileId: id,
              mode: 'production'
            });
            scriptFile = buildRes.scriptPath;
          }

          const content = await readFile(scriptFile, 'utf8');
          res.writeHead(200, {
            'Content-Type': 'application/javascript; charset=utf-8',
            'Access-Control-Allow-Origin': '*'
          });
          res.end(content);
        } catch (e) {
          res.writeHead(404, {'Content-Type': 'text/plain; charset=utf-8'});
          res.end(`Script build not available for profile: ${id}. Error: ${e instanceof Error ? e.message : String(e)}`);
        }
        return;
      }

      // API: GET /api/workspace
      if (req.method === 'GET' && pathname === '/api/workspace') {
        try {
          const ctx = await getContext();
          res.writeHead(200, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({
            ok: true,
            workspace: {
              file: ctx.file,
              root: ctx.root,
              upstream: ctx.upstream,
              profilesDir: ctx.profilesDir,
              outDir: ctx.outDir
            }
          }));
        } catch (e) {
          res.writeHead(200, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({
            ok: false,
            error: e instanceof Error ? e.message : String(e),
            fallback: true
          }));
        }
        return;
      }

      // API: GET /api/catalog
      if (req.method === 'GET' && pathname === '/api/catalog') {
        try {
          const ctx = await getContext();
          const catalog = await loadMetadataCatalog(ctx);
          res.writeHead(200, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({ok: true, catalog}));
        } catch (e) {
          res.writeHead(500, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({ok: false, error: e instanceof Error ? e.message : String(e)}));
        }
        return;
      }

      // API: GET /api/profiles
      if (req.method === 'GET' && pathname === '/api/profiles') {
        try {
          const ctx = await getContext();
          const profiles: Array<{id: string; abstract?: boolean; extends?: string; file: string; base?: string}> = [];
          
          async function scan(dir: string): Promise<void> {
            for (const item of await readdir(dir, {withFileTypes: true})) {
              const fullPath = path.join(dir, item.name);
              if (item.isDirectory()) {
                await scan(fullPath);
              } else if (item.name.endsWith('.json')) {
                try {
                  const content = JSON.parse(await readFile(fullPath, 'utf8'));
                  if (content.id) {
                    profiles.push({
                      id: content.id,
                      abstract: content.abstract,
                      extends: content.extends,
                      base: content.base,
                      file: path.relative(ctx.profilesDir, fullPath)
                    });
                  }
                } catch {
                  // Ignore invalid JSON
                }
              }
            }
          }

          await scan(ctx.profilesDir);
          res.writeHead(200, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({ok: true, profiles}));
        } catch (e) {
          res.writeHead(500, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({ok: false, error: e instanceof Error ? e.message : String(e)}));
        }
        return;
      }

      // API: GET /api/profiles/:id
      const profileMatch = pathname.match(/^\/api\/profiles\/([^/]+)$/);
      if (req.method === 'GET' && profileMatch) {
        const id = decodeURIComponent(profileMatch[1]);
        try {
          const ctx = await getContext();
          let targetFile: string | null = null;

          async function findProfile(dir: string): Promise<void> {
            for (const item of await readdir(dir, {withFileTypes: true})) {
              const fullPath = path.join(dir, item.name);
              if (item.isDirectory()) {
                await findProfile(fullPath);
              } else if (item.name.endsWith('.json')) {
                try {
                  const content = JSON.parse(await readFile(fullPath, 'utf8'));
                  if (content.id === id) {
                    targetFile = fullPath;
                    return;
                  }
                } catch {
                  // continue
                }
              }
            }
          }

          await findProfile(ctx.profilesDir);
          if (!targetFile) {
            res.writeHead(404, {'Content-Type': 'application/json'});
            res.end(JSON.stringify({ok: false, error: `Profile not found: ${id}`}));
            return;
          }

          const raw = await readFile(targetFile, 'utf8');
          const profile = JSON.parse(raw);
          res.writeHead(200, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({ok: true, profile, raw, file: path.relative(ctx.profilesDir, targetFile)}));
        } catch (e) {
          res.writeHead(500, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({ok: false, error: e instanceof Error ? e.message : String(e)}));
        }
        return;
      }

      // API: POST /api/validate
      if (req.method === 'POST' && pathname === '/api/validate') {
        const body = await parseJsonBody(req);
        const profile = body?.profile as Profile;
        if (!profile || typeof profile !== 'object') {
          res.writeHead(400, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({ok: false, error: 'Missing profile object in body'}));
          return;
        }

        const valid = profileValidator(profile);
        if (!valid) {
          res.writeHead(200, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({
            ok: false,
            diagnostics: (profileValidator.errors || []).map(err => ({
              code: 'SCHEMA_INVALID',
              message: `${err.instancePath} ${err.message}`
            }))
          }));
          return;
        }

        // Validate with catalog explain if available
        try {
          const ctx = await getContext();
          const catalog = await loadMetadataCatalog(ctx);
          const effectiveProfile = {
            id: profile.id,
            abstract: profile.abstract ?? false,
            base: profile.base ?? 'minimal',
            select: profile.selectAdd ?? [],
            settings: (profile.settings as Record<string, unknown>) ?? {},
            leaders: {
              site: profile.leaders?.site ?? '<Space>',
              search: profile.leaders?.search ?? 'a'
            },
            overrides: profile.overrides ?? [],
            provenance: {}
          };
          const explanation = explain(effectiveProfile, catalog);
          res.writeHead(200, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({ok: true, explanation}));
        } catch (err) {
          res.writeHead(200, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({
            ok: false,
            diagnostics: [{
              code: err instanceof Failure ? err.diagnostic.code : 'VALIDATION_ERROR',
              message: err instanceof Error ? err.message : String(err)
            }]
          }));
        }
        return;
      }

      // API: POST /api/profiles/:id
      if (req.method === 'POST' && profileMatch) {
        const id = decodeURIComponent(profileMatch[1]);
        const body = await parseJsonBody(req);
        const profile = body?.profile as Profile;

        if (!profile || typeof profile !== 'object' || profile.id !== id) {
          res.writeHead(400, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({ok: false, error: 'Profile ID mismatch or invalid payload'}));
          return;
        }

        if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
          res.writeHead(400, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({ok: false, error: `Invalid profile id format: ${id}`}));
          return;
        }

        const valid = profileValidator(profile);
        if (!valid) {
          res.writeHead(400, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({
            ok: false,
            error: ajv.errorsText(profileValidator.errors)
          }));
          return;
        }

        const ctx = await getContext();
        // Check safe target filename inside profilesDir
        const targetFilename = `${id}.json`;
        const targetPath = await inside(ctx.profilesDir, targetFilename, false);

        await writeFile(targetPath, `${JSON.stringify(profile, null, 2)}\n`, 'utf8');

        res.writeHead(200, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({
          ok: true,
          saved: path.relative(ctx.root, targetPath)
        }));
        return;
      }

      // API: POST /api/build (Build surfingkeys.js from real-time profile)
      if (req.method === 'POST' && pathname === '/api/build') {
        const body = await parseJsonBody(req);
        const profile = body?.profile as Profile;
        const mode = (body?.mode as 'production' | 'development') || 'production';

        if (!profile || typeof profile !== 'object' || !profile.id) {
          res.writeHead(400, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({ok: false, error: 'Missing profile object in request body'}));
          return;
        }

        if (profile.abstract) {
          res.writeHead(400, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({ok: false, error: 'Cannot build an abstract parent profile directly.'}));
          return;
        }

        const valid = profileValidator(profile);
        if (!valid) {
          res.writeHead(400, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({
            ok: false,
            error: ajv.errorsText(profileValidator.errors)
          }));
          return;
        }

        try {
          const ctx = await getContext();
          // Write profile to profiles directory to ensure persistence
          const targetFilename = `${profile.id}.json`;
          const targetPath = await inside(ctx.profilesDir, targetFilename, false);
          await writeFile(targetPath, `${JSON.stringify(profile, null, 2)}\n`, 'utf8');

          const buildResult = await buildWithSelectives({
            workspacePath: ctx.file,
            profileId: profile.id,
            mode
          });

          const scriptContent = await readFile(buildResult.scriptPath, 'utf8');

          res.writeHead(200, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({
            ok: true,
            profileId: buildResult.profileId,
            buildId: buildResult.buildId,
            scriptPath: path.relative(ctx.root, buildResult.scriptPath),
            reportPath: path.relative(ctx.root, buildResult.reportPath),
            scriptContent,
            outputs: buildResult.report.outputs,
            packages: buildResult.report.packages,
            analysis: {
              contributionsCount: buildResult.report.analysis.contributions.length,
              resolvedFeatures: buildResult.report.analysis.resolvedFeatures,
              externalDependencies: buildResult.report.analysis.retainedSymbols.externalDependencies
            }
          }));
        } catch (err) {
          res.writeHead(200, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({
            ok: false,
            error: err instanceof Error ? err.message : String(err),
            diagnostic: err instanceof Failure ? err.diagnostic : undefined
          }));
        }
        return;
      }

      // Static UI files serving
      let filePath: string;
      let contentType = 'text/html';

      if (pathname === '/' || pathname === '/index.html') {
        filePath = path.join(uiDir, 'index.html');
      } else if (pathname === '/style.css') {
        filePath = path.join(uiDir, 'style.css');
        contentType = 'text/css';
      } else if (pathname === '/app.js') {
        filePath = path.join(uiDir, 'app.js');
        contentType = 'application/javascript';
      } else {
        // Safe check for requested static file inside uiDir
        try {
          const rel = path.relative('/', pathname);
          filePath = await inside(uiDir, rel);
          if (filePath.endsWith('.css')) {
            contentType = 'text/css';
          } else if (filePath.endsWith('.js')) {
            contentType = 'application/javascript';
          } else if (filePath.endsWith('.json')) {
            contentType = 'application/json';
          }
        } catch {
          res.writeHead(404, {'Content-Type': 'text/plain'});
          res.end('Not Found');
          return;
        }
      }

      try {
        const fileContent = await readFile(filePath);
        res.writeHead(200, {'Content-Type': contentType});
        res.end(fileContent);
      } catch {
        res.writeHead(404, {'Content-Type': 'text/plain'});
        res.end('Not Found');
      }
    } catch (unhandledErr) {
      res.writeHead(500, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({
        ok: false,
        error: unhandledErr instanceof Error ? unhandledErr.message : String(unhandledErr)
      }));
    }
  });

  return {
    server,
    start: () => new Promise<void>((resolve) => {
      server.listen(port, host, () => {
        resolve();
      });
    }),
    close: () => new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    }),
    url: `http://${host}:${port}`
  };
}

async function parseJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown> | null> {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > 5 * 1024 * 1024) {
        req.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(raw.trim() ? JSON.parse(raw) : null);
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

// Standalone execution
if (process.argv[1] && process.argv[1].endsWith('server.js')) {
  let ws = 'surfingkeys.workspace.json';
  let p = 3000;
  let h = '127.0.0.1';

  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg === '--workspace' && process.argv[i + 1]) {
      ws = process.argv[++i];
    } else if (arg === '--port' && process.argv[i + 1]) {
      p = Number(process.argv[++i]);
    } else if (arg === '--host' && process.argv[i + 1]) {
      h = process.argv[++i];
    }
  }

  createVisualServer({workspacePath: ws, port: p, host: h})
    .then(async s => {
      await s.start();
      console.log(`⚡ SurfingKeys Visual Configuration Web UI ready: ${s.url}`);
      console.log(`   Workspace: ${ws}`);
      console.log(`   Press Ctrl+C to stop.`);
    })
    .catch(err => {
      console.error('Failed to start Visual Server:', err);
      process.exit(1);
    });
}
