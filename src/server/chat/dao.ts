import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ChatTurn } from './types';

/**
 * 对话历史落盘：<空间目录>/.chat/history.json。
 *
 * 只认「空间目录」这一个入参，不认识 SpaceInfo——存储层不该知道空间长什么样。
 * 目录以 . 开头，文件监听与文档树扫描都会跳过它。
 */

const CHAT_DIR = '.chat';
const HISTORY_FILE = 'history.json';
const STORE_VERSION = 1;

/** 磁盘上最多保留的消息条数，超出时裁掉最旧的 */
const STORE_LIMIT = 400;

export function historyFileOf(spaceDir: string): string {
  return path.join(spaceDir, CHAT_DIR, HISTORY_FILE);
}

export function loadTurns(spaceDir: string): ChatTurn[] {
  const file = historyFileOf(spaceDir);
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

/** 覆盖写入，并把条数裁到 STORE_LIMIT 之内（同步读写，天然串行） */
export function saveTurns(spaceDir: string, turns: ChatTurn[]): ChatTurn[] {
  const trimmed = turns.length > STORE_LIMIT ? turns.slice(turns.length - STORE_LIMIT) : turns;
  const file = historyFileOf(spaceDir);
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify({ version: STORE_VERSION, turns: trimmed }, null, 2)}\n`);
  } catch (error) {
    console.warn('[xdoc] 聊天历史写入失败：', error instanceof Error ? error.message : error);
  }
  return trimmed;
}
