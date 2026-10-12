import type { IncomingMessage, ServerResponse } from 'node:http';
import { spaceOf, type ServerContext } from '../context';
import { httpError, readJsonBody, sendJson } from '../kernel/http';
import type { MgrLlmClient } from './manager';
import { buildSystemPrompt, clearHistory, history, recordAnswer, recordQuestion } from './service';

/**
 * AI 助手端点。历史按空间持久化在 <space>/.chat/history.json。
 *
 * 模型 SDK 在这里才被 import：没用过 AI 的部署不该为它付出启动开销，
 * 因此 ctrl 是全项目唯一碰 @ai-sdk 的地方。
 */
export async function handleChat(
  ctx: ServerContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<boolean> {
  const { pathname } = url;

  if (pathname === '/api/chat/history') {
    const runtime = spaceOf(ctx, url);
    if (req.method === 'GET') {
      sendJson(res, 200, { turns: history(runtime.info) });
      return true;
    }
    if (req.method === 'DELETE') {
      clearHistory(runtime.info);
      sendJson(res, 200, { ok: true });
      return true;
    }
    throw httpError(405, '仅支持 GET / DELETE');
  }

  if (pathname === '/api/chat' && req.method === 'POST') {
    const runtime = spaceOf(ctx, url);
    const body = await readJsonBody(req);
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    const model = typeof body.model === 'string' ? body.model : undefined;
    const docPath = typeof body.docPath === 'string' && body.docPath ? body.docPath : undefined;
    if (!message) throw httpError(400, '缺少 message');

    const context = recordQuestion(runtime.info, message);

    let reply: string;
    try {
      const client = await llmClient(ctx);
      reply = await client.chat(context, runtime, {
        model,
        useTools: true,
        instructions: buildSystemPrompt(runtime.info, docPath),
      });
    } catch (error) {
      throw httpError(500, `LLM 调用失败: ${error instanceof Error ? error.message : String(error)}`);
    }

    if (reply.trim()) recordAnswer(runtime.info, reply);
    sendJson(res, 200, { reply });
    return true;
  }

  // 流式对话：NDJSON 事件流（reasoning / text / tool / error / done）。
  // 上下文为空间维度的持久历史（滑动窗口裁剪）；客户端断开时 abort LLM 请求并及时落库
  if (pathname === '/api/chat/stream' && req.method === 'POST') {
    const runtime = spaceOf(ctx, url);
    const body = await readJsonBody(req);
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    const model = typeof body.model === 'string' ? body.model : undefined;
    const docPath = typeof body.docPath === 'string' && body.docPath ? body.docPath : undefined;
    if (!message) throw httpError(400, '缺少 message');

    const context = recordQuestion(runtime.info, message);

    const controller = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) controller.abort();
    });

    let stream: Awaited<ReturnType<MgrLlmClient['stream']>>;
    try {
      const client = await llmClient(ctx);
      stream = await client.stream(context, runtime, {
        model,
        useTools: true,
        instructions: buildSystemPrompt(runtime.info, docPath),
        abortSignal: controller.signal,
      });
    } catch (error) {
      throw httpError(500, `LLM 调用失败: ${error instanceof Error ? error.message : String(error)}`);
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
    } catch (error) {
      if (!controller.signal.aborted) send({ type: 'error', message: error instanceof Error ? error.message : String(error) });
    } finally {
      if (answer.trim()) recordAnswer(runtime.info, answer, controller.signal.aborted);
      if (controller.signal.aborted) console.log('[xdoc] 聊天生成已中止（客户端断开）');
      res.end();
    }
    return true;
  }

  return false;
}

/** 模型客户端按需建、建一次就留着：SDK 加载开销只在第一次对话时付 */
async function llmClient(ctx: ServerContext): Promise<MgrLlmClient> {
  if (!ctx.llm) {
    const { MgrLlmClient: Impl } = await import('./manager');
    ctx.llm = new Impl(ctx.settings);
  }
  return ctx.llm;
}
