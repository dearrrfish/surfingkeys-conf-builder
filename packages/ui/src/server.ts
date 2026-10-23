#!/usr/bin/env node
import http from 'node:http';
import {readFile, readdir, writeFile, stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import AjvModule from 'ajv';
import {workspace, inside, Failure, loadMetadataCatalog, explain, buildWithSelectives} from '@skcb/core';
import type {Context, Profile} from '@skcb/core';

const Ajv = AjvModule.default;
const ajv = new Ajv({allErrors: true, strict: false});

export interface ServerOptions {
  workspacePath?: string;
  port?: number;
  host?: string;
  uiDir?: string;
  serveOnly?: boolean;
  token?: string;
  autoLock?: boolean;
}

export async function createVisualServer(options: ServerOptions = {}) {
  const workspacePath = options.workspacePath ?? 'surfingkeys.workspace.json';
  const port = options.port ?? Number(process.env.PORT || 3000);
  const host = options.host ?? (process.env.HOST || '127.0.0.1');
  const projectRoot = fileURLToPath(new URL('../', import.meta.url));
  const uiDir = options.uiDir ?? path.join(projectRoot, 'ui');
  const serveOnly = Boolean(options.serveOnly);
  const serverToken = options.token || process.env.SKCB_SERVE_TOKEN;

  let profileSchema: any;
  try {
    profileSchema = JSON.parse(await readFile(fileURLToPath(new URL('../schemas/profile.schema.json', import.meta.url)), 'utf8'));
  } catch {
    try {
      const coreSchemaPath = fileURLToPath(new URL('../../core/schemas/profile.schema.json', import.meta.url));
      profileSchema = JSON.parse(await readFile(coreSchemaPath, 'utf8'));
    } catch {
      profileSchema = {type: 'object'};
    }
  }
  const profileValidator = ajv.compile(profileSchema);

  async function getContext(): Promise<Context> {
    return workspace(workspacePath);
  }

  const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const parsedUrl = new URL(req.url ?? '/', `http://${host}:${port}`);
    const pathname = parsedUrl.pathname;

    // Token authentication check (if token is set)
    if (serverToken) {
      const authHeader = req.headers['authorization'];
      const queryToken = parsedUrl.searchParams.get('token');
      const valid = authHeader === `Bearer ${serverToken}` || queryToken === serverToken;
      if (!valid) {
        res.writeHead(401, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({ok: false, error: 'Unauthorized: invalid or missing token'}));
        return;
      }
    }

    // --serve-only check (prevent mutations)
    if (serveOnly && (req.method === 'POST' || pathname.startsWith('/api/profiles/save'))) {
      res.writeHead(403, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({ok: false, error: 'Forbidden: server is running in --serve-only read-only mode'}));
      return;
    }

    try {
      // API: GET /script/:id (Serve latest surfingkeys.js with ETag support)
      const scriptDirectMatch = pathname.match(/^\/script\/([^/]+)$/);
      if (req.method === 'GET' && scriptDirectMatch) {
        const id = decodeURIComponent(scriptDirectMatch[1]);
        try {
          const ctx = await getContext();
          const currentPointerPath = path.join(ctx.outDir, id, 'current.json');
          let scriptFile: string | null = null;
          let outputHash = '';
          try {
            const curRaw = await readFile(currentPointerPath, 'utf8');
            const cur = JSON.parse(curRaw);
            scriptFile = path.join(ctx.outDir, id, cur.artifacts.script);
            outputHash = cur.outputHash || '';
          } catch {
            const buildRes = await buildWithSelectives({
              workspacePath: ctx.file,
              profileId: id,
              mode: 'production',
              autoLock: options.autoLock
            });
            scriptFile = buildRes.scriptPath;
            outputHash = buildRes.outputHash || '';
          }

          if (outputHash && req.headers['if-none-match'] === `"${outputHash}"`) {
            res.writeHead(304);
            res.end();
            return;
          }

          const content = await readFile(scriptFile, 'utf8');
          res.writeHead(200, {
            'Content-Type': 'application/javascript; charset=utf-8',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'no-cache',
            ...(outputHash ? {'ETag': `"${outputHash}"`} : {})
          });
          res.end(content);
        } catch (e) {
          res.writeHead(404, {'Content-Type': 'text/plain; charset=utf-8'});
          res.end(`Script build not available for profile: ${id}. Error: ${e instanceof Error ? e.message : String(e)}`);
        }
        return;
      }

      // API: GET /dist/:id/builds/:buildId/surfingkeys.js (Immutable build endpoint)
      const immutableMatch = pathname.match(/^\/dist\/([^/]+)\/builds\/([^/]+)\/surfingkeys\.js$/);
      if (req.method === 'GET' && immutableMatch) {
        const [, id, buildId] = immutableMatch;
        try {
          const ctx = await getContext();
          const file = path.join(ctx.outDir, id, 'builds', buildId, 'surfingkeys.js');
          const content = await readFile(file, 'utf8');
          res.writeHead(200, {
            'Content-Type': 'application/javascript; charset=utf-8',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'public, max-age=31536000, immutable'
          });
          res.end(content);
        } catch {
          res.writeHead(404, {'Content-Type': 'text/plain; charset=utf-8'});
          res.end(`Build not found: ${id} / ${buildId}`);
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
          const profiles: Profile[] = [];
          const files = await readdir(ctx.profilesDir);
          for (const f of files) {
            if (f.endsWith('.json')) {
              try {
                const raw = await readFile(path.join(ctx.profilesDir, f), 'utf8');
                profiles.push(JSON.parse(raw));
              } catch {}
            }
          }
          res.writeHead(200, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({ok: true, profiles}));
        } catch (e) {
          res.writeHead(500, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({ok: false, error: e instanceof Error ? e.message : String(e)}));
        }
        return;
      }

      // API: POST /api/validate
      if (req.method === 'POST' && pathname === '/api/validate') {
        const body = await parseJsonBody(req);
        if (!body) {
          res.writeHead(400, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({ok: false, error: 'Empty or invalid JSON body'}));
          return;
        }

        const valid = profileValidator(body);
        if (!valid) {
          res.writeHead(200, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({
            ok: false,
            schemaErrors: profileValidator.errors
          }));
          return;
        }

        try {
          const ctx = await getContext();
          const catalog = await loadMetadataCatalog(ctx);
          const p = body as any;
          const effectiveProfile = {
            id: p.id,
            locale: p.locale || 'zh-CN',
            abstract: p.abstract ?? false,
            base: p.base ?? 'minimal',
            select: p.selectAdd ?? [],
            selectRemoveContributions: p.selectRemoveContributions ?? [],
            conflictResolution: p.conflictResolution ?? {mode: 'strict', modulePrecedence: []},
            settings: p.settings ?? {},
            leaders: {site: p.leaders?.site ?? '<Space>', search: p.leaders?.search ?? 'a'},
            overrides: p.overrides ?? [],
            provenance: {}
          };
          const explanation = explain(effectiveProfile, catalog);
          res.writeHead(200, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({ok: true, valid: true, explanation}));
        } catch (e) {
          res.writeHead(200, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({
            ok: false,
            error: e instanceof Error ? e.message : String(e),
            diagnostic: e instanceof Failure ? e.diagnostic : undefined
          }));
        }
        return;
      }

      // API: POST /api/profiles/save
      if (req.method === 'POST' && pathname === '/api/profiles/save') {
        const rawBody = await parseJsonBody(req);
        const body = rawBody as any;
        if (!body || !body.id) {
          res.writeHead(400, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({ok: false, error: 'Profile ID is required'}));
          return;
        }

        const valid = profileValidator(body);
        if (!valid) {
          res.writeHead(400, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({ok: false, error: 'Schema validation failed', details: profileValidator.errors}));
          return;
        }

        try {
          const ctx = await getContext();
          const p = body as any;
          const targetFile = await inside(ctx.profilesDir, `${p.id}.json`, false);
          await writeFile(targetFile, JSON.stringify(body, null, 2) + '\n', 'utf8');
          res.writeHead(200, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({ok: true, message: `Profile saved to ${p.id}.json`}));
        } catch (e) {
          res.writeHead(500, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({ok: false, error: e instanceof Error ? e.message : String(e)}));
        }
        return;
      }

      // API: POST /api/build
      if (req.method === 'POST' && pathname === '/api/build') {
        const body = await parseJsonBody(req);
        if (!body || !body.profile) {
          res.writeHead(400, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({ok: false, error: 'Missing profile definition in body'}));
          return;
        }

        try {
          const ctx = await getContext();
          const p = body.profile;
          const targetFile = await inside(ctx.profilesDir, `${p.id}.json`, false);
          await writeFile(targetFile, JSON.stringify(p, null, 2) + '\n', 'utf8');

          const buildResult = await buildWithSelectives({
            workspacePath: ctx.file,
            profileId: p.id,
            mode: 'production',
            autoLock: options.autoLock
          });

          res.writeHead(200, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({
            ok: true,
            buildResult: {
              profileId: buildResult.profileId,
              buildId: buildResult.buildId,
              directory: buildResult.directory,
              scriptPath: buildResult.scriptPath,
              outputHash: buildResult.outputHash,
              report: buildResult.report
            }
          }));
        } catch (e) {
          res.writeHead(500, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({
            ok: false,
            error: e instanceof Error ? e.message : String(e),
            diagnostic: e instanceof Failure ? e.diagnostic : undefined
          }));
        }
        return;
      }

      // Static UI files serving
      let reqPath = pathname === '/' ? '/index.html' : pathname;
      let filePath = path.join(uiDir, reqPath);

      try {
        const fileStat = await stat(filePath);
        if (fileStat.isDirectory()) {
          filePath = path.join(filePath, 'index.html');
        }
        const ext = path.extname(filePath).toLowerCase();
        const mimeTypes: Record<string, string> = {
          '.html': 'text/html; charset=utf-8',
          '.js': 'application/javascript; charset=utf-8',
          '.css': 'text/css; charset=utf-8',
          '.json': 'application/json; charset=utf-8',
          '.svg': 'image/svg+xml'
        };
        const contentType = mimeTypes[ext] || 'application/octet-stream';
        const fileContent = await readFile(filePath);
        res.writeHead(200, {'Content-Type': contentType});
        res.end(fileContent);
      } catch {
        res.writeHead(404, {'Content-Type': 'text/plain; charset=utf-8'});
        res.end('404 Not Found');
      }
    } catch (e) {
      res.writeHead(500, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({ok: false, error: e instanceof Error ? e.message : String(e)}));
    }
  });

  return {
    server,
    url: `http://${host}:${port}`,
    async start(): Promise<void> {
      return new Promise(resolve => {
        server.listen(port, host, () => resolve());
      });
    },
    async stop(): Promise<void> {
      return new Promise((resolve, reject) => {
        server.close(err => (err ? reject(err) : resolve()));
      });
    }
  };
}

async function parseJsonBody(req: http.IncomingMessage): Promise<any> {
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
  let serveOnly = false;
  let autoLock = false;
  let token: string | undefined;

  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg === '--workspace' && process.argv[i + 1]) {
      ws = process.argv[++i];
    } else if (arg === '--port' && process.argv[i + 1]) {
      p = Number(process.argv[++i]);
    } else if (arg === '--host' && process.argv[i + 1]) {
      h = process.argv[++i];
    } else if (arg === '--serve-only') {
      serveOnly = true;
    } else if (arg === '--auto-lock') {
      autoLock = true;
    } else if (arg === '--token' && process.argv[i + 1]) {
      token = process.argv[++i];
    }
  }

  createVisualServer({workspacePath: ws, port: p, host: h, serveOnly, token, autoLock})
    .then(async s => {
      await s.start();
      console.log(`⚡ SurfingKeys Visual Configuration Web UI ready: ${s.url}`);
      console.log(`   Workspace: ${ws}`);
      if (serveOnly) console.log(`   Mode: --serve-only (read-only script distribution)`);
      if (token) console.log(`   Auth: Token required`);
      console.log(`   Press Ctrl+C to stop.`);
    })
    .catch(err => {
      console.error('Failed to start Visual Server:', err);
      process.exit(1);
    });
}
