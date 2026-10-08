import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * <root>/index.json 只记录跨空间的索引信息：展示顺序与上次活跃空间。
 * 名称、备注等元数据一律以各空间自己的 meta.json 为准，不在此冗余存储。
 */
export interface SpaceIndex {
  version: number;
  /** 空间目录名（slug）的展示顺序 */
  order: string[];
  /** 上次活跃空间的 slug */
  lastActiveSpace?: string;
}

const INDEX_VERSION = 1;
const INDEX_FILE = 'index.json';
/** 早期版本的全局注册表，记录任意位置的空间目录 */
const LEGACY_FILE = 'spaces.json';

export function indexFileOf(root: string): string {
  return path.join(root, INDEX_FILE);
}

function emptyIndex(): SpaceIndex {
  return { version: INDEX_VERSION, order: [] };
}

/** 读取 root 索引，缺失或格式不符时按空索引处理 */
export function loadIndex(root: string): SpaceIndex {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(indexFileOf(root), 'utf8'));
  } catch {
    return emptyIndex();
  }
  if (!raw || typeof raw !== 'object') return emptyIndex();
  const entry = raw as Record<string, unknown>;

  const index: SpaceIndex = {
    version: typeof entry.version === 'number' ? entry.version : INDEX_VERSION,
    order: Array.isArray(entry.order)
      ? entry.order.filter((slug): slug is string => typeof slug === 'string' && slug.length > 0)
      : [],
  };
  if (typeof entry.lastActiveSpace === 'string' && entry.lastActiveSpace) {
    index.lastActiveSpace = entry.lastActiveSpace;
  }
  return index;
}

export function saveIndex(root: string, index: SpaceIndex): void {
  try {
    mkdirSync(root, { recursive: true });
    const payload: Record<string, unknown> = { version: INDEX_VERSION, order: index.order };
    if (index.lastActiveSpace) payload.lastActiveSpace = index.lastActiveSpace;
    writeFileSync(indexFileOf(root), `${JSON.stringify(payload, null, 2)}\n`);
  } catch (error) {
    console.warn('[xdoc] 索引写入失败：', error instanceof Error ? error.message : error);
  }
}

/**
 * 旧版注册表里的空间散落在任意路径，新模型下没有对应物。
 * 这里只列出仍然存在的目录并提示用户自行搬运，不擅自移动用户文档。
 */
export function legacyRegistryHint(root: string): string[] {
  const file = path.join(root, LEGACY_FILE);
  if (!existsSync(file)) return [];

  let data: { dirs?: unknown; spaces?: unknown };
  try {
    data = JSON.parse(readFileSync(file, 'utf8')) as { dirs?: unknown; spaces?: unknown };
  } catch {
    return [];
  }

  const dirs = Array.isArray(data.dirs)
    ? data.dirs.filter((dir): dir is string => typeof dir === 'string')
    : Array.isArray(data.spaces)
      ? data.spaces
          .map((entry) => (entry && typeof entry === 'object' ? (entry as Record<string, unknown>).root : null))
          .filter((dir): dir is string => typeof dir === 'string')
      : [];

  return dirs.filter((dir) => existsSync(dir) && !dir.startsWith(root + path.sep));
}
