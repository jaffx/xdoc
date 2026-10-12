import { existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { createMcpSession } from '../mcp/server';
import { handleAssets } from './assets/ctrl';
import { bootstrapSpaces } from './bootstrap';
import { handleChat } from './chat/ctrl';
import { handleSettings } from './settings/ctrl';
import { handleDoc } from './doc/ctrl';
import type { ServerContext, RouteHandler } from './context';
import { createEventHub } from './kernel/events';
import {
  MIME,
  bearerToken,
  decodePathname,
  findPublicDir,
  httpError,
  readBody,
  sendFile,
  sendJson,
  statusOf,
  tokenEquals,
} from './kernel/http';
import { resolveInside } from './kernel/paths';
import { SrvcSettings } from './settings/service';
import { SrvcSpaces, persistSpaceIndex } from './space/service';
import { handleSpaces } from './space/ctrl';

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

/**
 * 服务端组装点。
 *
 * 这个文件只做三件事：把外部世界的入口建起来（监听端口、TLS）、把各模块装配进
 * ServerContext、把请求按路径分给该管它的 ctrl。业务规则、存储形态、外部资源
 * 一概不在这里——按 R7，组装点只接线。
 */
export async function startServer(options: StartOptions): Promise<RunningServer> {
  const root = path.resolve(options.root);
  const publicDir = findPublicDir();
  const hub = createEventHub();

  // 设置面板背后那份配置：访问令牌与 AI 参数都从这里读写
  const settings = new SrvcSettings(root, options.token ?? '');
  const spaces = new SrvcSpaces(root, (event, data) => hub.broadcast(event, data));

  await bootstrapSpaces(spaces, root, (message) => console.log(`[xdoc] ${message}`));

  const ctx: ServerContext = {
    root,
    spaces,
    settings,
    hub,
    persistIndex(lastActiveSpace) {
      persistSpaceIndex(root, spaces, lastActiveSpace);
    },
  };

  // MCP 端点复用服务端的空间运行时：同一个进程里只保留一份空间视图，
  // 这样远端 Agent 写入的文档，网页端通过文件监听也能立刻看到
  const mcp = await createMcpSession({
    root,
    manager: spaces,
    persistIndex: ctx.persistIndex,
    log: (message) => console.log(`[xdoc-mcp] ${message}`),
  });

  // 顺序即优先级：一条路径归谁管由它自己认领（返回 false 就交给下一家）
  const routes: RouteHandler[] = [handleSpaces, handleDoc, handleAssets, handleSettings, handleChat];

  const handleMcp = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
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
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store' });
      res.write(`event: message\ndata: ${JSON.stringify(payload)}\n\n`);
      res.end();
      return;
    }
    sendJson(res, 200, payload);
  };

  const serveStatic = async (res: ServerResponse, pathname: string): Promise<void> => {
    const relative = pathname.replace(/^\/+/, '');
    if (!relative || relative === 'index.html') {
      const indexFile = path.join(publicDir, 'index.html');
      if (!existsSync(indexFile)) throw httpError(404, '前端资源缺失，请先执行 npm run build');
      sendFile(res, indexFile);
      return;
    }
    const staticFile = resolveInside(publicDir, relative);
    if (existsSync(staticFile) && (await stat(staticFile)).isFile()) {
      sendFile(res, staticFile);
      return;
    }
    throw httpError(404, '资源不存在');
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

      for (const route of routes) {
        if (await route(ctx, req, res, url)) return;
      }

      if (pathname === '/api/events') {
        hub.attach(req, res);
        return;
      }

      if (pathname === '/mcp') {
        await handleMcp(req, res);
        return;
      }

      if (pathname.startsWith('/api/')) {
        throw httpError(404, '接口不存在');
      }

      await serveStatic(res, pathname);
    } catch (error) {
      // 入口层只干一件事：把错误类型翻译成协议码。领域层不认识 HTTP
      const status = statusOf(error);
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
      hub.closeAll();
      await mcp.close();
      await spaces.closeAll();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
