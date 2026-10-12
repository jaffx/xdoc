import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ServerContext } from '../context';
import { httpError, readJsonBody, sendJson } from '../kernel/http';
import { publicSpace } from './service';

/** 空间管理端点：/api/spaces 的 GET / POST / PATCH / DELETE */
export async function handleSpaces(
  ctx: ServerContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<boolean> {
  if (url.pathname !== '/api/spaces') return false;

  if (req.method === 'POST') {
    const body = await readJsonBody(req);
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) throw httpError(400, '缺少 name');
    const description =
      typeof body.description === 'string' && body.description.trim() ? body.description.trim() : undefined;

    const { space, created } = await ctx.spaces.create({ name, description });
    if (created) {
      ctx.persistIndex();
      ctx.hub.broadcast('spaces', { action: 'add', space: publicSpace(space) });
      console.log(`[xdoc] 新建空间「${space.name}」-> ${space.slug}/`);
    }
    sendJson(res, 200, { space: publicSpace(space), created });
    return true;
  }

  if (req.method === 'PATCH') {
    const body = await readJsonBody(req);
    const id = typeof body.id === 'string' ? body.id : url.searchParams.get('id');
    if (!id) throw httpError(400, '缺少 id');
    const runtime = ctx.spaces.get(id);
    if (!runtime) throw httpError(404, '空间不存在');
    const space = await runtime.updateMetadata({
      name: typeof body.name === 'string' ? body.name : undefined,
      description: typeof body.description === 'string' ? body.description : undefined,
    });
    ctx.hub.broadcast('spaces', { action: 'update', space: publicSpace(space) });
    sendJson(res, 200, publicSpace(space));
    return true;
  }

  if (req.method === 'DELETE') {
    const id = url.searchParams.get('id');
    if (!id) throw httpError(400, '缺少 id');
    if (ctx.spaces.list().length <= 1) throw httpError(400, '至少保留一个空间');
    const runtime = ctx.spaces.get(id);
    if (!runtime) throw httpError(404, '空间不存在');
    const name = runtime.info.name;
    const trashed = await ctx.spaces.remove(id);
    ctx.persistIndex();
    ctx.hub.broadcast('spaces', { action: 'remove', id });
    console.log(`[xdoc] 空间「${name}」已移至回收站：${trashed}`);
    sendJson(res, 200, { ok: true });
    return true;
  }

  sendJson(res, 200, ctx.spaces.list().map(publicSpace));
  return true;
}
