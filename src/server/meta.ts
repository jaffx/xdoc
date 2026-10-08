import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { listDocPaths, SKIP_DIRS } from './tree';

/**
 * 空间目录结构：
 *
 *   my-space/
 *   ├── meta.json        # 空间身份（本文件）
 *   ├── xdoc.config.ts   # 空间级扩展
 *   └── doc/             # 文档根目录，所有 markdown 与资源
 *
 * id 生成一次后写入 meta.json，因此空间目录整体移动或改名都不会换身份。
 */
export interface SpaceMeta {
  id: string;
  name: string;
  description?: string;
  createdAt: number;
  updatedAt: number;
}

/** 初始化空间时可带入的元数据（如从旧注册表迁移而来） */
export type SpaceMetaSeed = Partial<Omit<SpaceMeta, 'id'>>;

const META_FILE = 'meta.json';
const DOC_DIR = 'doc';
const CONFIG_RE = /^xdoc\.config\.(ts|mts|js|mjs)$/;
const MD_RE = /\.(md|markdown)$/i;

/** 空间内的文档根目录 */
export function docRootOf(dir: string): string {
  return path.join(dir, DOC_DIR);
}

export function metaFileOf(dir: string): string {
  return path.join(dir, META_FILE);
}

export function isMetaFile(file: string): boolean {
  return path.basename(file) === META_FILE;
}

export function generateSpaceId(): string {
  return randomBytes(5).toString('hex');
}

/** 读取 meta.json，缺失或格式不符时返回 null（按未初始化处理） */
export async function readMeta(dir: string): Promise<SpaceMeta | null> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(metaFileOf(dir), 'utf8'));
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const entry = raw as Record<string, unknown>;
  if (typeof entry.id !== 'string' || !entry.id) return null;

  const now = Date.now();
  const meta: SpaceMeta = {
    id: entry.id,
    name: typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : path.basename(dir),
    createdAt: typeof entry.createdAt === 'number' ? entry.createdAt : now,
    updatedAt: typeof entry.updatedAt === 'number' ? entry.updatedAt : now,
  };
  if (typeof entry.description === 'string' && entry.description.trim()) {
    meta.description = entry.description.trim();
  }
  return meta;
}

/**
 * 读取缺少 id 的 meta.json（如内置模板只写了名称与备注），
 * 把其中的字段作为初始化种子。模板不带 id，复制到每个 root 后各自生成独立身份。
 */
export async function readMetaSeed(dir: string): Promise<SpaceMetaSeed> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(metaFileOf(dir), 'utf8'));
  } catch {
    return {};
  }
  if (!raw || typeof raw !== 'object') return {};
  const entry = raw as Record<string, unknown>;

  const seed: SpaceMetaSeed = {};
  if (typeof entry.name === 'string' && entry.name.trim()) seed.name = entry.name.trim();
  if (typeof entry.description === 'string' && entry.description.trim()) seed.description = entry.description.trim();
  if (typeof entry.createdAt === 'number') seed.createdAt = entry.createdAt;
  if (typeof entry.updatedAt === 'number') seed.updatedAt = entry.updatedAt;
  return seed;
}

export async function writeMeta(dir: string, meta: SpaceMeta): Promise<void> {
  const payload: Record<string, unknown> = { id: meta.id, name: meta.name };
  if (meta.description) payload.description = meta.description;
  payload.createdAt = meta.createdAt;
  payload.updatedAt = meta.updatedAt;
  await mkdir(dir, { recursive: true });
  await writeFile(metaFileOf(dir), `${JSON.stringify(payload, null, 2)}\n`);
}

/** 顶层条目是否应随文档一起迁移进 doc/ */
function isMigratable(name: string): boolean {
  if (name === META_FILE || name === DOC_DIR) return false;
  if (name.startsWith('.') || SKIP_DIRS.has(name)) return false;
  return !CONFIG_RE.test(name);
}

/**
 * 收集需要迁移的顶层条目：仅当目录里确实存在 markdown（含嵌套）时才迁移，
 * 这样空目录只做初始化，不会无故搬动用户文件。
 */
async function collectMigration(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const candidates = entries.filter((entry) => isMigratable(entry.name));
  for (const entry of candidates) {
    const hasMarkdown = entry.isDirectory()
      ? (await listDocPaths(path.join(dir, entry.name))).length > 0
      : MD_RE.test(entry.name);
    if (hasMarkdown) return candidates.map((entry) => entry.name);
  }
  return [];
}

async function scaffoldIndex(docRoot: string, title: string): Promise<void> {
  await writeFile(
    path.join(docRoot, 'index.md'),
    `# ${title}\n\n这是空间的文档根目录，把 markdown 文档放进来即可浏览。\n\n:::tip\n每个空间拥有独立的 \`doc/\` 目录与 \`xdoc.config.ts\` 扩展配置。\n:::\n`,
  );
}

export interface EnsureSpaceResult {
  meta: SpaceMeta;
  /** 迁移进 doc/ 的顶层条目数，0 表示没有发生迁移 */
  migrated: number;
  /** 是否新建了 meta.json */
  initialized: boolean;
}

/**
 * 幂等地准备好空间目录：建 doc/、迁移旧的平铺文档、生成 meta.json。
 * 已有 meta.json 的空间只补齐 doc/，不再触碰任何文件。
 */
export async function ensureSpaceDir(dir: string, seed: SpaceMetaSeed = {}): Promise<EnsureSpaceResult> {
  const docRoot = docRootOf(dir);
  const existing = await readMeta(dir);
  if (existing) {
    await mkdir(docRoot, { recursive: true });
    return { meta: existing, migrated: 0, initialized: false };
  }

  await mkdir(dir, { recursive: true });
  // 目录里已有一份缺 id 的 meta.json（内置模板、手写）时沿用其中的名称与备注
  const merged: SpaceMetaSeed = { ...(await readMetaSeed(dir)), ...seed };
  const migrating = await collectMigration(dir);
  await mkdir(docRoot, { recursive: true });

  let migrated = 0;
  for (const name of migrating) {
    const target = path.join(docRoot, name);
    // 同名条目已在 doc/ 下时保留原文件，不覆盖用户数据
    if (existsSync(target)) continue;
    await rename(path.join(dir, name), target);
    migrated++;
  }

  const name = merged.name?.trim() || path.basename(dir) || 'space';
  if ((await listDocPaths(docRoot)).length === 0) await scaffoldIndex(docRoot, name);

  const now = Date.now();
  const meta: SpaceMeta = {
    id: generateSpaceId(),
    name,
    createdAt: merged.createdAt ?? now,
    updatedAt: merged.updatedAt ?? now,
  };
  if (merged.description?.trim()) meta.description = merged.description.trim();
  await writeMeta(dir, meta);
  return { meta, migrated, initialized: true };
}
