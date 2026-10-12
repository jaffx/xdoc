import type { SpaceInfo } from '../space/service';
import { loadTurns, saveTurns } from './dao';
import type { ChatMessage, ChatTurn } from './types';

/**
 * 对话模块对外的能力面，也是它的业务规则所在：
 * 历史留多少条、送模型多少条、系统提示词怎么拼——都不是协议，也不是存储。
 *
 * 模型的调用不在这里。这里只负责「该给模型看什么」，调用在 ../chat/manager。
 */

/** 送给模型的历史条数上限 */
export const CONTEXT_MAX_MESSAGES = 40;
/** 送给模型的历史字符预算（粗略按 2 字符 ≈ 1 token 估算） */
export const CONTEXT_MAX_CHARS = 16000;

export type { ChatMessage, ChatTurn } from './types';

export function history(info: SpaceInfo): ChatTurn[] {
  return loadTurns(info.dir);
}

export function clearHistory(info: SpaceInfo): void {
  saveTurns(info.dir, []);
}

/**
 * 滑动窗口：从最新往回取，直到触达条数上限或字符预算。
 * 最新一条永不裁剪——否则用户刚发的问题进不了模型。
 */
export function windowMessages(
  turns: ChatTurn[],
  options: { maxMessages?: number; maxChars?: number } = {},
): ChatMessage[] {
  const maxMessages = options.maxMessages ?? CONTEXT_MAX_MESSAGES;
  const maxChars = options.maxChars ?? CONTEXT_MAX_CHARS;

  const result: ChatMessage[] = [];
  let chars = 0;
  for (let i = turns.length - 1; i >= 0; i--) {
    if (result.length >= maxMessages) break;
    const turn = turns[i];
    if (result.length > 0 && chars + turn.content.length > maxChars) break;
    result.unshift({ role: turn.role, content: turn.content });
    chars += turn.content.length;
  }
  return result;
}

/** 记下用户这一问，并返回裁剪后的上下文——省得调用方自己拼这一步 */
export function recordQuestion(info: SpaceInfo, content: string): ChatMessage[] {
  const turns = saveTurns(info.dir, [...loadTurns(info.dir), { role: 'user', content, at: Date.now() }]);
  return windowMessages(turns);
}

/** 记下模型的回答；stopped 表示这次回答被用户中断 */
export function recordAnswer(info: SpaceInfo, content: string, stopped = false): void {
  saveTurns(info.dir, [
    ...loadTurns(info.dir),
    { role: 'assistant', content, at: Date.now(), ...(stopped ? { stopped: true } : {}) },
  ]);
}

export function buildSystemPrompt(info: SpaceInfo, docPath?: string): string {
  const lines = [
    `你是 xdoc 的 AI 助手，负责解答关于空间「${info.name}」内文档的问题。`,
    '你可以用工具读取（read_doc）、浏览（list_docs）、搜索（search_docs）空间内的文档。回答前先查阅相关文档，不要凭空猜测。',
    '回答使用 markdown 排版；需要重点提示、对比表格、流程说明时，可用 xdoc 嵌入体语法（:::tip、:::table、:::mermaid）。',
  ];
  if (docPath) {
    lines.push(`用户当前正在浏览文档：${docPath}。问题与它相关时，优先阅读这篇。`);
  }
  return lines.join('\n');
}
