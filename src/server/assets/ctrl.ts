import { existsSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { spaceOf, spaceOfBody, type ServerContext } from '../context';
import { httpError, parseMultipart, readJsonBody, sendFile, sendJson } from '../kernel/http';

/** 素材库端点：列表、上传、改名、删除、取文件 */
export async function handleAssets(
  ctx: ServerContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<boolean> {
  const { pathname } = url;

  if (pathname === '/api/assets' && req.method === 'GET') {
    const runtime = spaceOf(ctx, url);
    const items = await runtime.assets.list(url.searchParams.get('dir') ?? undefined);
    sendJson(res, 200, { space: runtime.info.id, items });
    return true;
  }

  if (pathname === '/api/assets/upload' && req.method === 'POST') {
    const contentType = req.headers['content-type'] ?? '';
    if (!contentType.includes('multipart/form-data')) throw httpError(400, '需要 multipart/form-data');

    const runtime = spaceOf(ctx, url);
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);

    const boundary = contentType.split('boundary=')[1];
    if (!boundary) throw httpError(400, '缺少 boundary');

    const parts = parseMultipart(Buffer.concat(chunks), boundary);
    const filePart = parts.find((part) => part.name === 'file');
    if (!filePart?.filename) throw httpError(400, '缺少 file 字段');

    const targetPath = parts.find((part) => part.name === 'path')?.data.toString('utf8');
    const asset = await runtime.assets.upload(filePart.data, filePart.filename, targetPath);

    ctx.hub.broadcast('assets', { space: runtime.info.id, event: 'add', path: asset.path });
    sendJson(res, 200, { space: runtime.info.id, asset });
    return true;
  }

  if (pathname === '/api/assets/rename' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const runtime = spaceOfBody(ctx, body);
    const from = String(body.from ?? '');
    const to = String(body.to ?? '');
    const newPath = await runtime.assets.rename(from, to);
    ctx.hub.broadcast('assets', { space: runtime.info.id, event: 'rename', from, to: newPath });
    sendJson(res, 200, { space: runtime.info.id, from, to: newPath });
    return true;
  }

  if (pathname === '/api/assets' && req.method === 'DELETE') {
    const runtime = spaceOf(ctx, url);
    const rel = url.searchParams.get('path');
    if (!rel) throw httpError(400, '缺少 path 参数');
    await runtime.assets.delete(rel);
    ctx.hub.broadcast('assets', { space: runtime.info.id, event: 'delete', path: rel });
    sendJson(res, 200, { space: runtime.info.id, path: rel });
    return true;
  }

  if (pathname === '/api/assets/file') {
    const runtime = spaceOf(ctx, url);
    const rel = url.searchParams.get('path');
    if (!rel) throw httpError(400, '缺少 path 参数');
    const absolute = runtime.assets.resolve(rel);
    if (!existsSync(absolute)) throw httpError(404, '素材不存在');
    sendFile(res, absolute);
    return true;
  }

  return false;
}
