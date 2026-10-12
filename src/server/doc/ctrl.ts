import { readFile, stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { spaceOf, spaceOfBody, type ServerContext } from '../context';
import { MIME, httpError, readJsonBody, sendFile, sendJson } from '../kernel/http';
import { resolveInside } from '../kernel/paths';
import { assertDocPath, createDoc, createFolder, deleteEntry, locate, readDoc, renameEntry, scanTree } from './service';

/** 从渲染结果里取标题，取不到就让调用方退回文件名 */
function extractTitle(html: string): string | null {
  const match = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  if (!match) return null;
  return match[1].replace(/<[^>]+>/g, '').trim() || null;
}

/**
 * 文档模块的端点：目录与文件的增删改、渲染、原始文本、样式与嵌入体清单。
 *
 * 这些是最常被别处调用的能力（AI 工具、MCP），所以真正的读写都在 ./service 上，
 * 这里只做协议：取参、定状态码、发广播。
 */
export async function handleDoc(
  ctx: ServerContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<boolean> {
  const { pathname } = url;

  if (pathname === '/api/mkdir' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const runtime = spaceOfBody(ctx, body);
    const rel = await createFolder(runtime.info.docRoot, String(body.path ?? ''));
    ctx.hub.broadcast('tree', { space: runtime.info.id, event: 'add', path: rel });
    sendJson(res, 200, { space: runtime.info.id, path: rel });
    return true;
  }

  if (pathname === '/api/file' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const runtime = spaceOfBody(ctx, body);
    const rel = await createDoc(
      runtime.info.docRoot,
      String(body.path ?? ''),
      typeof body.content === 'string' ? body.content : undefined,
    );
    ctx.hub.broadcast('tree', { space: runtime.info.id, event: 'add', path: rel });
    sendJson(res, 200, { space: runtime.info.id, path: rel });
    return true;
  }

  if (pathname === '/api/rename' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const runtime = spaceOfBody(ctx, body);
    const rel = await renameEntry(runtime.info.docRoot, String(body.from ?? ''), String(body.to ?? ''));
    ctx.hub.broadcast('tree', { space: runtime.info.id, event: 'rename', path: rel });
    sendJson(res, 200, { space: runtime.info.id, path: rel });
    return true;
  }

  if (pathname === '/api/entry' && req.method === 'DELETE') {
    const runtime = spaceOf(ctx, url);
    const rel = url.searchParams.get('path');
    if (!rel) throw httpError(400, '缺少 path 参数');
    await deleteEntry(runtime.info.docRoot, rel, url.searchParams.get('recursive') === 'true');
    ctx.hub.broadcast('tree', { space: runtime.info.id, event: 'unlink', path: rel });
    sendJson(res, 200, { space: runtime.info.id, path: rel });
    return true;
  }

  if (pathname === '/api/tree') {
    const runtime = spaceOf(ctx, url);
    sendJson(res, 200, await scanTree(runtime.info.docRoot));
    return true;
  }

  if (pathname === '/api/doc') {
    const runtime = spaceOf(ctx, url);
    const rel = url.searchParams.get('path');
    if (!rel) throw httpError(400, '缺少 path 参数');
    // 先判路径是否越界，再判是不是 markdown——顺序反了会把 ../.. 报成 400
    const absolute = resolveInside(runtime.info.docRoot, rel);
    assertDocPath(rel);
    const { content: source } = await readDoc(runtime.info.docRoot, rel);
    const html = runtime.renderer.render(source, {
      path: rel,
      root: runtime.info.docRoot,
      space: runtime.info.id,
    });
    const info = await stat(absolute);
    // 打开一篇文档就算这个空间活跃，下次启动回到这里
    ctx.persistIndex(runtime.info.slug);
    sendJson(res, 200, {
      space: runtime.info.id,
      path: rel,
      title: extractTitle(html) ?? path.basename(rel, path.extname(rel)),
      html,
      mtime: info.mtimeMs,
    });
    return true;
  }

  if (pathname === '/api/raw') {
    const runtime = spaceOf(ctx, url);
    const rel = url.searchParams.get('path');
    if (!rel) throw httpError(400, '缺少 path 参数');
    const absolute = await locate(runtime.info.docRoot, rel);
    res.writeHead(200, { 'Content-Type': MIME['.txt'], 'Cache-Control': 'no-store' });
    res.end(await readFile(absolute, 'utf8'));
    return true;
  }

  if (pathname === '/api/render' && req.method === 'POST') {
    const runtime = spaceOf(ctx, url);
    const body = await readJsonBody(req);
    const markdown = typeof body.markdown === 'string' ? body.markdown : '';
    if (!markdown.trim()) throw httpError(400, '缺少 markdown');
    const html = runtime.renderer.render(markdown, { root: runtime.info.docRoot, space: runtime.info.id });
    sendJson(res, 200, { html });
    return true;
  }

  // 文档根目录下的任意文件（图片、附件）：不走素材库，直接按路径取
  if (pathname === '/api/asset') {
    const runtime = spaceOf(ctx, url);
    const rel = url.searchParams.get('path');
    if (!rel) throw httpError(400, '缺少 path 参数');
    sendFile(res, await locate(runtime.info.docRoot, rel));
    return true;
  }

  if (pathname === '/api/styles') {
    const runtime = spaceOf(ctx, url);
    res.writeHead(200, { 'Content-Type': MIME['.css'], 'Cache-Control': 'no-store' });
    res.end(runtime.styles.join('\n\n'));
    return true;
  }

  if (pathname === '/api/embeds') {
    const runtime = spaceOf(ctx, url);
    sendJson(
      res,
      200,
      runtime.renderer.registry.list().map((definition) => ({
        name: definition.name,
        aliases: definition.aliases ?? [],
        description: definition.description ?? '',
      })),
    );
    return true;
  }

  return false;
}
