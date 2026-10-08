import { createReadStream, existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bootstrapSpaces } from './bootstrap';
import {
  createDoc,
  createFolder,
  deleteEntry,
  expandHome,
  OperationError,
  renameEntry,
  resolveInside,
  scaffoldSpaceDir,
} from './operations';
import { savePersistedSpaces } from './persistence';
import { SpaceManager, type SpaceRuntime } from './space';
import { scanTree } from './tree';

export interface StartOptions {
  /** 每个目录成为一个空间，顺序即展示顺序 */
  roots: string[];
  port?: number;
  host?: string;
}

export interface RunningServer {
  port: number;
  url: string;
  close: () => Promise<void>;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.pdf': 'application/pdf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

interface HttpError extends Error {
  statusCode: number;
}

function httpError(statusCode: number, message: string): HttpError {
  return Object.assign(new Error(message), { statusCode });
}

function findPublicDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(here, 'public'),
    path.join(here, '..', '..', 'dist', 'public'),
    path.join(process.cwd(), 'dist', 'public'),
    path.join(process.cwd(), 'public'),
  ];
  return candidates.find((dir) => existsSync(path.join(dir, 'index.html'))) ?? candidates[0];
}

function safeResolve(root: string, rel: string): string {
  try {
    return resolveInside(root, rel);
  } catch (error) {
    if (error instanceof OperationError) throw httpError(error.statusCode, error.message);
    throw error;
  }
}

function extractTitle(html: string): string | null {
  const match = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  if (!match) return null;
  return match[1].replace(/<[^>]+>/g, '').trim() || null;
}

function decodePathname(pathname: string): string {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return pathname;
  }
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 64 * 1024) throw httpError(413, '请求体过大');
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
  } catch {
    throw httpError(400, 'JSON 解析失败');
  }
}

export async function startServer(options: StartOptions): Promise<RunningServer> {
  if (options.roots.length === 0) throw new Error('至少需要一个文档目录');

  const publicDir = findPublicDir();
  const sseClients = new Set<ServerResponse>();
  const broadcast = (event: string, data: unknown) => {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of sseClients) client.write(payload);
  };

  const manager = new SpaceManager((event, data) => broadcast(event, data));

  await bootstrapSpaces(manager, options.roots, (message) => console.log(`[xdoc] ${message}`));

  const persistRegistry = () => savePersistedSpaces(manager.entries());

  const sendJson = (res: ServerResponse, status: number, data: unknown) => {
    const body = JSON.stringify(data);
    res.writeHead(status, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
    res.end(body);
  };

  const sendFile = (res: ServerResponse, file: string) => {
    const type = MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    createReadStream(file).pipe(res);
  };

  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
      const pathname = decodePathname(url.pathname);

      const resolveSpace = (): SpaceRuntime => {
        const id = url.searchParams.get('space');
        const runtime = id ? manager.get(id) : manager.default();
        if (!runtime) throw httpError(404, id ? `空间不存在：${id}` : '尚未加载任何空间');
        return runtime;
      };

      // ---- 空间管理 ----
      if (pathname === '/api/spaces') {
        if (req.method === 'POST') {
          const body = await readJsonBody(req);
          const rootInput = typeof body.path === 'string' ? body.path.trim() : '';
          if (!rootInput) throw httpError(400, '缺少 path');
          const resolvedRoot = path.resolve(expandHome(rootInput));
          const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : undefined;
          const description =
            typeof body.description === 'string' && body.description.trim() ? body.description.trim() : undefined;

          if (body.create === true) {
            await scaffoldSpaceDir(resolvedRoot, name);
          }

          const now = Date.now();
          const { space, created } = await manager.add({
            root: resolvedRoot,
            name,
            description,
            source: 'user',
            tracked: true,
            createdAt: now,
            updatedAt: now,
          });
          if (created) {
            persistRegistry();
            broadcast('spaces', { action: 'add', space });
            console.log(`[xdoc] ${body.create === true ? '新建' : '新增'}空间「${space.name}」-> ${space.root}`);
          }
          sendJson(res, 200, { space, created });
          return;
        }
        if (req.method === 'PATCH') {
          const body = await readJsonBody(req);
          const id = typeof body.id === 'string' ? body.id : url.searchParams.get('id');
          if (!id) throw httpError(400, '缺少 id');
          const runtime = manager.get(id);
          if (!runtime) throw httpError(404, '空间不存在');
          const space = runtime.updateMetadata({
            name: typeof body.name === 'string' ? body.name : undefined,
            description: typeof body.description === 'string' ? body.description : undefined,
          });
          persistRegistry();
          broadcast('spaces', { action: 'update', space });
          sendJson(res, 200, space);
          return;
        }
        if (req.method === 'DELETE') {
          const id = url.searchParams.get('id');
          if (!id) throw httpError(400, '缺少 id');
          if (manager.list().length <= 1) throw httpError(400, '至少保留一个空间');
          const runtime = manager.get(id);
          if (!runtime) throw httpError(404, '空间不存在');
          await manager.remove(id);
          persistRegistry();
          broadcast('spaces', { action: 'remove', id });
          console.log(`[xdoc] 已移除空间「${runtime.info.name}」`);
          sendJson(res, 200, { ok: true });
          return;
        }
        sendJson(res, 200, manager.list());
        return;
      }

      // ---- 目录与文件管理 ----
      const resolveSpaceFromBody = (body: Record<string, unknown>): SpaceRuntime => {
        const id = typeof body.space === 'string' ? body.space : null;
        const runtime = id ? manager.get(id) : manager.default();
        if (!runtime) throw httpError(404, id ? `空间不存在：${id}` : '尚未加载任何空间');
        return runtime;
      };

      if (pathname === '/api/mkdir' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const runtime = resolveSpaceFromBody(body);
        const rel = await createFolder(runtime.info.root, String(body.path ?? ''));
        broadcast('tree', { space: runtime.info.id, event: 'add', path: rel });
        sendJson(res, 200, { space: runtime.info.id, path: rel });
        return;
      }

      if (pathname === '/api/file' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const runtime = resolveSpaceFromBody(body);
        const rel = await createDoc(
          runtime.info.root,
          String(body.path ?? ''),
          typeof body.content === 'string' ? body.content : undefined,
        );
        broadcast('tree', { space: runtime.info.id, event: 'add', path: rel });
        sendJson(res, 200, { space: runtime.info.id, path: rel });
        return;
      }

      if (pathname === '/api/rename' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const runtime = resolveSpaceFromBody(body);
        const rel = await renameEntry(runtime.info.root, String(body.from ?? ''), String(body.to ?? ''));
        broadcast('tree', { space: runtime.info.id, event: 'rename', path: rel });
        sendJson(res, 200, { space: runtime.info.id, path: rel });
        return;
      }

      if (pathname === '/api/entry' && req.method === 'DELETE') {
        const runtime = resolveSpace();
        const rel = url.searchParams.get('path');
        if (!rel) throw httpError(400, '缺少 path 参数');
        const recursive = url.searchParams.get('recursive') === 'true';
        await deleteEntry(runtime.info.root, rel, recursive);
        broadcast('tree', { space: runtime.info.id, event: 'unlink', path: rel });
        sendJson(res, 200, { space: runtime.info.id, path: rel });
        return;
      }

      // ---- 文档与资源 ----
      if (pathname === '/api/tree') {
        const runtime = resolveSpace();
        sendJson(res, 200, await scanTree(runtime.info.root));
        return;
      }

      if (pathname === '/api/doc') {
        const runtime = resolveSpace();
        const rel = url.searchParams.get('path');
        if (!rel) throw httpError(400, '缺少 path 参数');
        const absolute = safeResolve(runtime.info.root, rel);
        if (!['.md', '.markdown'].includes(path.extname(absolute).toLowerCase())) {
          throw httpError(400, '仅支持渲染 markdown 文件');
        }
        if (!existsSync(absolute)) throw httpError(404, `文件不存在：${rel}`);
        const source = await readFile(absolute, 'utf8');
        const html = runtime.renderer.render(source, { path: rel, root: runtime.info.root, space: runtime.info.id });
        const info = await stat(absolute);
        sendJson(res, 200, {
          space: runtime.info.id,
          path: rel,
          title: extractTitle(html) ?? path.basename(rel, path.extname(rel)),
          html,
          mtime: info.mtimeMs,
        });
        return;
      }

      if (pathname === '/api/raw') {
        const runtime = resolveSpace();
        const rel = url.searchParams.get('path');
        if (!rel) throw httpError(400, '缺少 path 参数');
        const absolute = safeResolve(runtime.info.root, rel);
        if (!existsSync(absolute)) throw httpError(404, `文件不存在：${rel}`);
        const source = await readFile(absolute, 'utf8');
        res.writeHead(200, { 'Content-Type': MIME['.txt'], 'Cache-Control': 'no-store' });
        res.end(source);
        return;
      }

      if (pathname === '/api/asset') {
        const runtime = resolveSpace();
        const rel = url.searchParams.get('path');
        if (!rel) throw httpError(400, '缺少 path 参数');
        const absolute = safeResolve(runtime.info.root, rel);
        if (!existsSync(absolute)) throw httpError(404, '文件不存在');
        sendFile(res, absolute);
        return;
      }

      if (pathname === '/api/styles') {
        const runtime = resolveSpace();
        res.writeHead(200, { 'Content-Type': MIME['.css'], 'Cache-Control': 'no-store' });
        res.end(runtime.styles.join('\n\n'));
        return;
      }

      if (pathname === '/api/embeds') {
        const runtime = resolveSpace();
        sendJson(
          res,
          200,
          runtime.renderer.registry.list().map((definition) => ({
            name: definition.name,
            aliases: definition.aliases ?? [],
            description: definition.description ?? '',
          })),
        );
        return;
      }

      if (pathname === '/api/events') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
        });
        res.write(': connected\n\n');
        sseClients.add(res);
        req.on('close', () => sseClients.delete(res));
        return;
      }

      if (pathname.startsWith('/api/')) {
        throw httpError(404, '接口不存在');
      }

      // ---- 静态资源 ----
      const relative = pathname.replace(/^\/+/, '');
      if (!relative || relative === 'index.html') {
        const indexFile = path.join(publicDir, 'index.html');
        if (!existsSync(indexFile)) throw httpError(404, '前端资源缺失，请先执行 npm run build');
        sendFile(res, indexFile);
        return;
      }
      const staticFile = safeResolve(publicDir, relative);
      if (existsSync(staticFile) && (await stat(staticFile)).isFile()) {
        sendFile(res, staticFile);
        return;
      }
      throw httpError(404, '资源不存在');
    } catch (error) {
      const status = (error as HttpError).statusCode ?? 500;
      const message = error instanceof Error ? error.message : String(error);
      if (status >= 500) console.error('[xdoc]', error);
      sendJson(res, status, { error: message });
    }
  };

  const server = createHttpServer(handler);

  const listen = (port: number, host: string) =>
    new Promise<number>((resolve, reject) => {
      const onError = (error: NodeJS.ErrnoException) => {
        server.off('listening', onListening);
        reject(error);
      };
      const onListening = () => {
        server.off('error', onError);
        resolve((server.address() as AddressInfo).port);
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(port, host);
    });

  const host = options.host ?? '127.0.0.1';
  const basePort = options.port ?? 3000;
  let actualPort = 0;
  let lastError: unknown;
  for (let attempt = 0; attempt < (options.port == null ? 10 : 1); attempt++) {
    try {
      actualPort = await listen(basePort + attempt, host);
      lastError = undefined;
      break;
    } catch (error) {
      lastError = error;
      if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error;
    }
  }
  if (lastError) {
    throw new Error(`端口 ${basePort} 已被占用，可用 --port 指定其他端口`);
  }

  const url = `http://${host === '0.0.0.0' ? 'localhost' : host}:${actualPort}`;

  return {
    port: actualPort,
    url,
    close: async () => {
      for (const client of sseClients) client.end();
      sseClients.clear();
      await manager.closeAll();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}