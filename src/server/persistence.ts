import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface PersistedSpace {
  /** 空间根目录（绝对路径） */
  root: string;
  /** 自定义名称 */
  name?: string;
  /** 备注 */
  description?: string;
  createdAt?: number;
  updatedAt?: number;
}

function storageFile(): string {
  const home = process.env.XDOC_HOME ?? path.join(os.homedir(), '.xdoc');
  return path.join(home, 'spaces.json');
}

function normalize(raw: unknown): PersistedSpace | null {
  if (!raw || typeof raw !== 'object') return null;
  const entry = raw as Record<string, unknown>;
  if (typeof entry.root !== 'string' || !entry.root) return null;
  const space: PersistedSpace = { root: entry.root };
  if (typeof entry.name === 'string' && entry.name) space.name = entry.name;
  if (typeof entry.description === 'string' && entry.description) space.description = entry.description;
  if (typeof entry.createdAt === 'number') space.createdAt = entry.createdAt;
  if (typeof entry.updatedAt === 'number') space.updatedAt = entry.updatedAt;
  return space;
}

/** 读取空间注册表（含元数据），兼容旧版本格式 */
export function loadPersistedSpaces(): PersistedSpace[] {
  try {
    const data = JSON.parse(readFileSync(storageFile(), 'utf8')) as { spaces?: unknown };
    if (!Array.isArray(data.spaces)) return [];
    return data.spaces
      .map(normalize)
      .filter((entry): entry is PersistedSpace => entry !== null);
  } catch {
    return [];
  }
}

export function savePersistedSpaces(spaces: PersistedSpace[]): void {
  try {
    const file = storageFile();
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify({ version: 2, spaces }, null, 2)}\n`);
  } catch (error) {
    console.warn('[xdoc] 空间注册表持久化失败：', error instanceof Error ? error.message : error);
  }
}