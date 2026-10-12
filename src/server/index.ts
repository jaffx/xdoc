import { timingSafeEqual } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMcpSession } from '../mcp/server';
import { bootstrapSpaces } from './bootstrap';
import type { LlmClient } from './llm/index';
import { createDoc, createFolder, deleteEntry, OperationError, renameEntry, resolveInside } from './operations';
import { loadIndex, saveIndex } from './persistence';
import { SettingsStore, type SettingsPatch } from './settings';
import { publicSpace, SpaceManager, type SpaceRuntime } from './space';
import { scanTree } from './tree';

export interface StartOptions {
  /** 数据根目录，空间位于 <root>/spaces 下 */
  root: string;
  port?: number;
  host?: string;
  /** 访问令牌。设置后 /api/* 与 /mcp 都要求 Bearer 令牌，静态资源不受影响 */
  token?: string;
  /** TLS 证书与私钥（PEM）。设置后用 https 提供服务 */
  tls?: { cert: Buffer; key: Buffer };
}

const MCP_BODY_LIMIT = 16 * 1024 * 1024;

export interface RunningServer {
  port: number;
  url: string;
  close: () => Promise<void>;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  // ES module 分块（mermaid 等），必须是 JS MIME，否则浏览器拒绝加载
  '.mjs': 'text/javascript; charset=utf-8',
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

async function readBody(req: IncomingMessage, maxBytes = 64 * 1024): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw httpError(413, '请求体过大');
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * 设置面板提交的改动：只收认识的字段，其余忽略。
 * 字段缺省 = 不改；空串 = 清掉，这条语义在 SettingsStore.update 里落实。
 */
function parseSettingsPatch(body: Record<string, unknown>): SettingsPatch {
  const patch: SettingsPatch = {};
  const ai = body.ai;
  if (ai && typeof ai === 'object' && !Array.isArray(ai)) {
    const source = ai as Record<string, unknown>;
    const fields: NonNullable<SettingsPatch['ai']> = {};
    for (const key of ['apiKey', 'baseURL', 'model'] as const) {
      const value = source[key];
      if (typeof value === 'string') fields[key] = value;
    }
    patch.ai = fields;
  }
  if (typeof body.token === 'string') patch.token = body.token;
  return patch;
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const raw = await readBody(req);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw httpError(400, 'JSON 解析失败');
  }
}

interface MultipartPart {
  name: string;
  filename?: string;
  data: Buffer;
}

function parseMultipart(body: Buffer, boundary: string): MultipartPart[] {
  const parts: MultipartPart[] = [];
  const boundaryBuffer = Buffer.from(`--${boundary}`);
  const endBuffer = Buffer.from(`--${boundary}--`);

  let start = body.indexOf(boundaryBuffer);
  if (start === -1) return parts;

  while (true) {
    start = body.indexOf(boundaryBuffer, start);
    if (start === -1) break;

    start += boundaryBuffer.length;
    if (body[start] === 0x0d && body[start + 1] === 0x0a) {
      start += 2;
    }

    const end = body.indexOf(boundaryBuffer, start);
    if (end === -1) break;

    const partData = body.subarray(start, end);
    const headerEnd = partData.indexOf('\r\n\r\n');
    if (headerEnd === -1) continue;

    const headers = partData.subarray(0, headerEnd).toString('utf8');
    const content = partData.subarray(headerEnd + 4, partData.length - 2);

    const nameMatch = /name="([^"]+)"/.exec(headers);
    const filenameMatch = /filename="([^"]+)"/.exec(headers);

    if (nameMatch) {
      parts.push({
        name: nameMatch[1],
        filename: filenameMatch?.[1],
        data: content,
      });
    }

    if (body.subarray(end, end + endBuffer.length).equals(endBuffer)) break;
  }

  return parts;
}

/** Authorization: Bearer <令牌> 里的令牌部分，取不到返回空串 */
function bearerToken(req: IncomingMessage): string {
  const raw = req.headers.authorization;
  if (typeof raw !== 'string') return '';
  const match = /^Bearer\s+(.+)$/i.exec(raw.trim());
  return match ? match[1].trim() : '';
}

/** 等长比较，避免按字符逐位比较泄露令牌前缀 */
function tokenEquals(expected: string, actual: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(actual);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function startServer(options: StartOptions): Promise<RunningServer> {
  const root = path.resolve(options.root);
  // 设置面板背后那份配置：访问令牌与 AI 参数都从这里读写
  const settings = new SettingsStore(root, options.token ?? '');
  const publicDir = findPublicDir();
  const sseClients = new Set<ServerResponse>();
  const broadcast = (event: string, data: unknown) => {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of sseClients) client.write(payload);
  };

  const manager = new SpaceManager(root, (event, data) => broadcast(event, data));

  await bootstrapSpaces(manager, root, (message) => console.log(`[xdoc] ${message}`));

  const persistIndex = (lastActiveSpace?: string) => {
    const index = loadIndex(root);
    saveIndex(root, {
      ...index,
      order: manager.order(),
      lastActiveSpace: lastActiveSpace ?? index.lastActiveSpace,
    });
  };

  const sendJson = (res: ServerResponse, status: number, data: unknown) => {
    const body = JSON.stringify(data);
    res.writeHead(status, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
    res.end(body);
  };

  // MCP 端点复用服务端的空间运行时：同一个进程里只保留一份空间视图，
  // 这样远端 Agent 写入的文档，网页端通过文件监听也能立刻看到
  const mcp = await createMcpSession({
    root,
    manager,
    persistIndex,
    log: (message) => console.log(`[xdoc-mcp] ${message}`),
  });

  // 模型 SDK 只在真的用到 AI 助手时才加载（import type 不产生运行时代码）
  let llm: LlmClient | null = null;
  const llmClient = async (): Promise<LlmClient> => {
    if (!llm) {
      const { LlmClient: Impl } = await import('./llm/index');
      llm = new Impl(settings);
    }
    return llm;
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

      // 令牌只保护数据接口；静态资源放行，否则页面本身都打不开，也就没法让用户输入令牌。
      // 查询串形式是给浏览器里设不了请求头的请求用的（<img>、EventSource）。
      const guarded = pathname === '/mcp' || pathname.startsWith('/api/');
      // 每次请求现取：设置面板里改了令牌要立刻生效，不能只在启动时读一次
      const token = settings.token;
      if (token && guarded) {
        const provided = bearerToken(req) || url.searchParams.get('token') || '';
        if (!tokenEquals(token, provided)) {
          res.writeHead(401, {
            'Content-Type': MIME['.json'],
            'WWW-Authenticate': 'Bearer',
            'Cache-Control': 'no-store',
          });
          res.end(JSON.stringify({ error: '需要访问令牌' }));
          return;
        }
      }

      const resolveSpace = (): SpaceRuntime => {
        const id = url.searchParams.get('space');
        if (!id) {
          const fallback = manager.default();
          if (!fallback) throw httpError(404, '尚未加载任何空间');
          return fallback;
        }
        const byId = manager.get(id);
        if (byId) return byId;
        // 与 MCP 一致：id 找不到时按名称兜底（不区分大小写）
        const key = id.trim().toLowerCase();
        const byName = manager.list().find((space) => space.name.toLowerCase() === key);
        if (byName) return manager.get(byName.id)!;
        throw httpError(404, `空间不存在：${id}`);
      };

      // ---- 空间管理 ----
      if (pathname === '/api/spaces') {
        if (req.method === 'POST') {
          const body = await readJsonBody(req);
          const name = typeof body.name === 'string' ? body.name.trim() : '';
          if (!name) throw httpError(400, '缺少 name');
          const description =
            typeof body.description === 'string' && body.description.trim() ? body.description.trim() : undefined;

          const { space, created } = await manager.create({ name, description });
          if (created) {
            persistIndex();
            broadcast('spaces', { action: 'add', space: publicSpace(space) });
            console.log(`[xdoc] 新建空间「${space.name}」-> ${space.slug}/`);
          }
          sendJson(res, 200, { space: publicSpace(space), created });
          return;
        }
        if (req.method === 'PATCH') {
          const body = await readJsonBody(req);
          const id = typeof body.id === 'string' ? body.id : url.searchParams.get('id');
          if (!id) throw httpError(400, '缺少 id');
          const runtime = manager.get(id);
          if (!runtime) throw httpError(404, '空间不存在');
          const space = await runtime.updateMetadata({
            name: typeof body.name === 'string' ? body.name : undefined,
            description: typeof body.description === 'string' ? body.description : undefined,
          });
          broadcast('spaces', { action: 'update', space: publicSpace(space) });
          sendJson(res, 200, publicSpace(space));
          return;
        }
        if (req.method === 'DELETE') {
          const id = url.searchParams.get('id');
          if (!id) throw httpError(400, '缺少 id');
          if (manager.list().length <= 1) throw httpError(400, '至少保留一个空间');
          const runtime = manager.get(id);
          if (!runtime) throw httpError(404, '空间不存在');
          const name = runtime.info.name;
          const trashed = await manager.remove(id);
          persistIndex();
          broadcast('spaces', { action: 'remove', id });
          console.log(`[xdoc] 空间「${name}」已移至回收站：${trashed}`);
          sendJson(res, 200, { ok: true });
          return;
        }
        sendJson(res, 200, manager.list().map(publicSpace));
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
        const rel = await createFolder(runtime.info.docRoot, String(body.path ?? ''));
        broadcast('tree', { space: runtime.info.id, event: 'add', path: rel });
        sendJson(res, 200, { space: runtime.info.id, path: rel });
        return;
      }

      if (pathname === '/api/file' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const runtime = resolveSpaceFromBody(body);
        const rel = await createDoc(
          runtime.info.docRoot,
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
        const rel = await renameEntry(runtime.info.docRoot, String(body.from ?? ''), String(body.to ?? ''));
        broadcast('tree', { space: runtime.info.id, event: 'rename', path: rel });
        sendJson(res, 200, { space: runtime.info.id, path: rel });
        return;
      }

      if (pathname === '/api/entry' && req.method === 'DELETE') {
        const runtime = resolveSpace();
        const rel = url.searchParams.get('path');
        if (!rel) throw httpError(400, '缺少 path 参数');
        const recursive = url.searchParams.get('recursive') === 'true';
        await deleteEntry(runtime.info.docRoot, rel, recursive);
        broadcast('tree', { space: runtime.info.id, event: 'unlink', path: rel });
        sendJson(res, 200, { space: runtime.info.id, path: rel });
        return;
      }

      // ---- 素材管理 ----
      if (pathname === '/api/assets' && req.method === 'GET') {
        const runtime = resolveSpace();
        const dir = url.searchParams.get('dir') ?? undefined;
        const items = await runtime.assets.list(dir);
        sendJson(res, 200, { space: runtime.info.id, items });
        return;
      }

      if (pathname === '/api/assets/upload' && req.method === 'POST') {
        const contentType = req.headers['content-type'] ?? '';
        if (!contentType.includes('multipart/form-data')) {
          throw httpError(400, '需要 multipart/form-data');
        }

        const runtime = resolveSpace();
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        const body = Buffer.concat(chunks);

        const boundary = contentType.split('boundary=')[1];
        if (!boundary) throw httpError(400, '缺少 boundary');

        const parts = parseMultipart(body, boundary);
        const filePart = parts.find((p) => p.name === 'file');
        if (!filePart || !filePart.filename) throw httpError(400, '缺少 file 字段');

        const targetPath = parts.find((p) => p.name === 'path')?.data.toString('utf8');
        const asset = await runtime.assets.upload(filePart.data, filePart.filename, targetPath);

        broadcast('assets', { space: runtime.info.id, event: 'add', path: asset.path });
        sendJson(res, 200, { space: runtime.info.id, asset });
        return;
      }

      if (pathname === '/api/assets/rename' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const runtime = resolveSpaceFromBody(body);
        const from = String(body.from ?? '');
        const to = String(body.to ?? '');
        const newPath = await runtime.assets.rename(from, to);
        broadcast('assets', { space: runtime.info.id, event: 'rename', from, to: newPath });
        sendJson(res, 200, { space: runtime.info.id, from, to: newPath });
        return;
      }

      if (pathname === '/api/assets' && req.method === 'DELETE') {
        const runtime = resolveSpace();
        const rel = url.searchParams.get('path');
        if (!rel) throw httpError(400, '缺少 path 参数');
        await runtime.assets.delete(rel);
        broadcast('assets', { space: runtime.info.id, event: 'delete', path: rel });
        sendJson(res, 200, { space: runtime.info.id, path: rel });
        return;
      }

      if (pathname === '/api/assets/file') {
        const runtime = resolveSpace();
        const rel = url.searchParams.get('path');
        if (!rel) throw httpError(400, '缺少 path 参数');
        const absolute = runtime.assets.resolve(rel);
        if (!existsSync(absolute)) throw httpError(404, '素材不存在');
        sendFile(res, absolute);
        return;
      }

      // ---- 文档与资源 ----
      if (pathname === '/api/tree') {
        const runtime = resolveSpace();
        sendJson(res, 200, await scanTree(runtime.info.docRoot));
        return;
      }

      if (pathname === '/api/doc') {
        const runtime = resolveSpace();
        const rel = url.searchParams.get('path');
        if (!rel) throw httpError(400, '缺少 path 参数');
        const absolute = safeResolve(runtime.info.docRoot, rel);
        if (!['.md', '.markdown'].includes(path.extname(absolute).toLowerCase())) {
          throw httpError(400, '仅支持渲染 markdown 文件');
        }
        if (!existsSync(absolute)) throw httpError(404, `文件不存在：${rel}`);
        const source = await readFile(absolute, 'utf8');
        const html = runtime.renderer.render(source, { path: rel, root: runtime.info.docRoot, space: runtime.info.id });
        const info = await stat(absolute);
        persistIndex(runtime.info.slug);
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
        const absolute = safeResolve(runtime.info.docRoot, rel);
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
        const absolute = safeResolve(runtime.info.docRoot, rel);
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

      // ---- 设置面板（令牌 + AI 配置，落在 <root>/config.json）----

      if (pathname === '/api/settings') {
        if (req.method === 'GET') {
          sendJson(res, 200, settings.publicView());
          return;
        }
        if (req.method === 'PATCH') {
          const body = await readJsonBody(req);
          sendJson(res, 200, await settings.update(parseSettingsPatch(body)));
          return;
        }
        throw httpError(405, '仅支持 GET / PATCH');
      }

      // ---- AI 助手（对话历史按空间持久化在 <space>/.chat/history.json）----

      if (pathname === '/api/chat/history') {
        const runtime = resolveSpace();
        const { loadChatHistory, clearChatHistory } = await import('./chat');
        if (req.method === 'GET') {
          sendJson(res, 200, { turns: loadChatHistory(runtime.info) });
          return;
        }
        if (req.method === 'DELETE') {
          clearChatHistory(runtime.info);
          sendJson(res, 200, { ok: true });
          return;
        }
        throw httpError(405, '仅支持 GET / DELETE');
      }

      if (pathname === '/api/chat' && req.method === 'POST') {
        const runtime = resolveSpace();
        const body = await readJsonBody(req);
        const message = typeof body.message === 'string' ? body.message.trim() : '';
        const model = typeof body.model === 'string' ? body.model : undefined;
        const docPath = typeof body.docPath === 'string' && body.docPath ? body.docPath : undefined;

        if (!message) {
          throw httpError(400, '缺少 message');
        }

        const { appendChatTurns, buildSystemPrompt, loadChatHistory, windowMessages } = await import('./chat');

        try {
          appendChatTurns(runtime.info, [{ role: 'user', content: message, at: Date.now() }]);
          const context = windowMessages(loadChatHistory(runtime.info));
          const client = await llmClient();
          const reply = await client.chat(context, runtime, {
            model,
            useTools: true,
            instructions: buildSystemPrompt(runtime.info, docPath),
          });
          if (reply.trim()) {
            appendChatTurns(runtime.info, [{ role: 'assistant', content: reply, at: Date.now() }]);
          }
          sendJson(res, 200, { reply });
        } catch (error: any) {
          throw httpError(500, `LLM 调用失败: ${error.message}`);
        }
        return;
      }

      // 流式对话：NDJSON 事件流（reasoning / text / tool / error / done）。
      // 上下文为空间维度的持久历史（滑动窗口裁剪）；客户端断开时 abort LLM 请求并及时落库
      if (pathname === '/api/chat/stream' && req.method === 'POST') {
        const runtime = resolveSpace();
        const body = await readJsonBody(req);
        const message = typeof body.message === 'string' ? body.message.trim() : '';
        const model = typeof body.model === 'string' ? body.model : undefined;
        const docPath = typeof body.docPath === 'string' && body.docPath ? body.docPath : undefined;

        if (!message) {
          throw httpError(400, '缺少 message');
        }

        const { appendChatTurns, buildSystemPrompt, loadChatHistory, windowMessages } = await import('./chat');

        appendChatTurns(runtime.info, [{ role: 'user', content: message, at: Date.now() }]);
        const context = windowMessages(loadChatHistory(runtime.info));

        const controller = new AbortController();
        res.on('close', () => {
          if (!res.writableEnded) controller.abort();
        });

        let stream: Awaited<ReturnType<LlmClient['stream']>>;
        try {
          const client = await llmClient();
          stream = await client.stream(context, runtime, {
            model,
            useTools: true,
            instructions: buildSystemPrompt(runtime.info, docPath),
            abortSignal: controller.signal,
          });
        } catch (error: any) {
          throw httpError(500, `LLM 调用失败: ${error.message}`);
        }

        res.writeHead(200, {
          'Content-Type': 'application/x-ndjson; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-Accel-Buffering': 'no',
        });

        const send = (event: unknown) => {
          if (!res.writableEnded) res.write(JSON.stringify(event) + '\n');
        };

        let answer = '';
        try {
          for await (const part of stream.fullStream) {
            if (controller.signal.aborted) break;
            switch (part.type) {
              case 'reasoning-delta':
                send({ type: 'reasoning', delta: part.text });
                break;
              case 'text-delta':
                answer += part.text;
                send({ type: 'text', delta: part.text });
                break;
              case 'tool-input-start':
                send({ type: 'tool', name: part.toolName });
                break;
              case 'error': {
                const errorMessage = part.error instanceof Error ? part.error.message : String(part.error);
                send({ type: 'error', message: errorMessage });
                break;
              }
            }
          }
          send({ type: 'done' });
        } catch (error: any) {
          if (!controller.signal.aborted) {
            send({ type: 'error', message: error?.message ?? String(error) });
          }
        } finally {
          if (answer.trim()) {
            appendChatTurns(runtime.info, [
              {
                role: 'assistant',
                content: answer,
                at: Date.now(),
                ...(controller.signal.aborted ? { stopped: true } : {}),
              },
            ]);
          }
          if (controller.signal.aborted) console.log('[xdoc] 聊天生成已中止（客户端断开）');
          res.end();
        }
        return;
      }

      // 把一段 markdown（含 xdoc 嵌入体）按空间扩展渲染为 HTML
      if (pathname === '/api/render' && req.method === 'POST') {
        const runtime = resolveSpace();
        const body = await readJsonBody(req);
        const markdown = typeof body.markdown === 'string' ? body.markdown : '';
        if (!markdown.trim()) throw httpError(400, '缺少 markdown');
        const html = runtime.renderer.render(markdown, {
          root: runtime.info.docRoot,
          space: runtime.info.id,
        });
        sendJson(res, 200, { html });
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

      // ---- MCP（Streamable HTTP）----
      // 单端点：POST 一条或一批 JSON-RPC 消息，请求有 id 就回响应，纯通知回 202。
      // 不分配会话 id（无状态），因此不需要 Mcp-Session-Id 头。
      if (pathname === '/mcp') {
        if (req.method !== 'POST') {
          res.writeHead(405, { Allow: 'POST', 'Content-Type': MIME['.json'] });
          res.end(JSON.stringify({ error: 'MCP 端点只接受 POST' }));
          return;
        }
        // 规范要求校验 Origin：浏览器页面跨站打这个端点就是 DNS rebinding，直接挡掉
        const origin = req.headers.origin;
        if (typeof origin === 'string') {
          let originHost = '';
          try {
            originHost = new URL(origin).host;
          } catch {
            originHost = '';
          }
          if (originHost !== (req.headers.host ?? '')) throw httpError(403, 'Origin 不被信任');
        }

        const raw = await readBody(req, MCP_BODY_LIMIT);
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          throw httpError(400, 'JSON 解析失败');
        }
        const batch = Array.isArray(parsed);
        const messages = batch ? (parsed as unknown[]) : [parsed];
        const responses: unknown[] = [];
        for (const message of messages) {
          const response = await mcp.handle(message as Record<string, unknown>);
          if (response !== null) responses.push(response);
        }

        if (responses.length === 0) {
          // 只有通知：按规范回 202，不带消息体
          res.writeHead(202, { 'Cache-Control': 'no-store' });
          res.end();
          return;
        }

        const payload = batch ? responses : responses[0];
        const accept = req.headers.accept ?? '';
        // 客户端只接受 SSE 时按事件流回（每条消息一个 message 事件），否则直接回 JSON
        if (!accept.includes('application/json') && accept.includes('text/event-stream')) {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-store',
          });
          res.write(`event: message\ndata: ${JSON.stringify(payload)}\n\n`);
          res.end();
          return;
        }
        sendJson(res, 200, payload);
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

  const server = options.tls ? createHttpsServer(options.tls, handler) : createHttpServer(handler);

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
  const basePort = options.port ?? 1998;
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

  const scheme = options.tls ? 'https' : 'http';
  const url = `${scheme}://${host === '0.0.0.0' ? 'localhost' : host}:${actualPort}`;

  return {
    port: actualPort,
    url,
    close: async () => {
      for (const client of sseClients) client.end();
      sseClients.clear();
      await mcp.close();
      await manager.closeAll();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}