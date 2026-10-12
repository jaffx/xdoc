import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ServerContext } from '../context';
import { httpError, readJsonBody, sendJson } from '../kernel/http';
import type { SettingsPatch } from './service';

/**
 * 设置面板端点：GET 看当前配置（密钥只给掩码），PATCH 改。
 * 设置是进程级的，不挂在任何空间下，所以不走 spaceOf。
 */
export async function handleSettings(
  ctx: ServerContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<boolean> {
  if (url.pathname !== '/api/settings') return false;

  const settings = ctx.settings;
  if (req.method === 'GET') {
    sendJson(res, 200, settings.publicView());
    return true;
  }
  if (req.method === 'PATCH') {
    sendJson(res, 200, await settings.update(parseSettingsPatch(await readJsonBody(req))));
    return true;
  }
  throw httpError(405, '仅支持 GET / PATCH');
}

/**
 * 只收认识的字段，其余忽略。
 * 字段缺省 = 不改；空串 = 清掉，这条语义在 SrvcSettings.update 里落实。
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
