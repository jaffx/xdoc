import type { IncomingMessage, ServerResponse } from 'node:http';
import type { MgrLlmClient } from './chat/manager';
import type { EventHub } from './kernel/events';
import { httpError } from './kernel/http';
import type { SrvcSettings } from './settings/service';
import type { SrvcSpaces, MgrSpaceRuntime } from './space/service';

/**
 * 组装点与各模块之间的契约。
 *
 * 模块的 ctrl 只认这个接口，不 import ./index——组装点依赖所有模块，模块一个都不许反过来依赖它。
 */
export interface ServerContext {
  /** 数据根目录 */
  root: string;
  spaces: SrvcSpaces;
  settings: SrvcSettings;
  /** SSE 广播：跨模块共享，模块只管发，不关心谁在听 */
  hub: EventHub;
  /** 把当前空间顺序与活跃空间落到 <root>/index.json */
  persistIndex(lastActiveSpace?: string): void;
  /** 模型客户端，首次用 AI 时惰性建出（import type 不产生运行时代码） */
  llm?: MgrLlmClient;
}

/**
 * 一条路由。
 *
 * 返回 true 表示这条路径归本模块管、响应已经写完；返回 false 表示不认，交给下一家。
 * ctrl 因此不必知道别的模块有哪些路径。
 */
export type RouteHandler = (
  ctx: ServerContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
) => Promise<boolean>;

/** 按 ?space= 找空间；不带就取默认空间 */
export function spaceOf(ctx: ServerContext, url: URL): MgrSpaceRuntime {
  const id = url.searchParams.get('space');
  if (!id) {
    const fallback = ctx.spaces.default();
    if (!fallback) throw httpError(404, '尚未加载任何空间');
    return fallback;
  }
  const byId = ctx.spaces.get(id);
  if (byId) return byId;
  // 与 MCP 一致：id 找不到时按名称兜底（不区分大小写）
  const key = id.trim().toLowerCase();
  const byName = ctx.spaces.list().find((space) => space.name.toLowerCase() === key);
  if (byName) return ctx.spaces.get(byName.id)!;
  throw httpError(404, `空间不存在：${id}`);
}

/** 按请求体里的 space 字段找空间；不带就取默认空间。写操作走这条，因为它们的载荷本来就是 JSON */
export function spaceOfBody(ctx: ServerContext, body: Record<string, unknown>): MgrSpaceRuntime {
  const id = typeof body.space === 'string' ? body.space : null;
  const runtime = id ? ctx.spaces.get(id) : ctx.spaces.default();
  if (!runtime) throw httpError(404, id ? `空间不存在：${id}` : '尚未加载任何空间');
  return runtime;
}
