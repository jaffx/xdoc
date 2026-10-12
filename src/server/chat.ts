import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { SpaceInfo } from './space';

/** 一条对话记录（仅存最终文本，不存思考过程与工具调用） */
export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
  /** 写入时间戳（ms） */
  at: number;
  /** 该回答是否被用户中断 */
  stopped?: boolean;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/** 聊天历史存于空间目录下的 .chat/（以 . 开头，文件监听与目录扫描都会跳过） */
const CHAT_DIR = '.chat';
const HISTORY_FILE = 'history.json';
const STORE_VERSION = 1;

/** 磁盘上最多保留的消息条数，超出时裁掉最旧的 */
const STORE_LIMIT = 400;
/** 送给模型的历史条数上限 */
export const CONTEXT_MAX_MESSAGES = 40;
/** 送给模型的历史字符预算（粗略按 2 字符 ≈ 1 token 估算） */
export const CONTEXT_MAX_CHARS = 16000;

function historyFile(info: SpaceInfo): string {
  return path.join(info.dir, CHAT_DIR, HISTORY_FILE);
}

export function loadChatHistory(info: SpaceInfo): ChatTurn[] {
  const file = historyFile(info);
  if (!existsSync(file)) return [];
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as { turns?: unknown };
    if (!raw || !Array.isArray(raw.turns)) return [];
    return raw.turns.filter(
      (entry): entry is ChatTurn =>
        !!entry &&
        typeof entry === 'object' &&
        ((entry as ChatTurn).role === 'user' || (entry as ChatTurn).role === 'assistant') &&
        typeof (entry as ChatTurn).content === 'string',
    );
  } catch {
    return [];
  }
}

/** 追加若干对话记录，并把文件裁剪到 STORE_LIMIT 之内（同步读写，天然串行） */
export function appendChatTurns(info: SpaceInfo, turns: ChatTurn[]): ChatTurn[] {
  const merged = [...loadChatHistory(info), ...turns];
  const trimmed = merged.length > STORE_LIMIT ? merged.slice(merged.length - STORE_LIMIT) : merged;
  const file = historyFile(info);
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify({ version: STORE_VERSION, turns: trimmed }, null, 2)}\n`);
  } catch (error) {
    console.warn('[xdoc] 聊天历史写入失败：', error instanceof Error ? error.message : error);
  }
  return trimmed;
}

export function clearChatHistory(info: SpaceInfo): void {
  const file = historyFile(info);
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify({ version: STORE_VERSION, turns: [] }, null, 2)}\n`);
  } catch (error) {
    console.warn('[xdoc] 聊天历史清空失败：', error instanceof Error ? error.message : error);
  }
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