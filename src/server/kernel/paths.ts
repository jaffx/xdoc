import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { InvalidPathError, PathEscapeError } from './errors';

/** 扫描目录树时一律跳过的目录名 */
export const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', '.git', '.idea', '.vscode', '.obsidian']);

const SEGMENT_RE = /^[^/\\<>:"|?*\u0000-\u001f]+$/;

/** 展开 ~ 开头的路径 */
export function expandHome(input: string): string {
  if (input === '~') return os.homedir();
  if (input.startsWith('~/') || input.startsWith('~\\')) return path.join(os.homedir(), input.slice(2));
  return input;
}

/** 校验单个路径片段（目录名/文件名） */
export function assertSegment(segment: string, label = '名称'): void {
  if (segment === '..') throw new PathEscapeError('路径越界');
  if (!segment || segment === '.') throw new InvalidPathError(`${label}不能为空`);
  if (segment.startsWith('.')) throw new InvalidPathError(`${label}不能以 . 开头`);
  if (!SEGMENT_RE.test(segment)) throw new InvalidPathError(`${label}包含非法字符：${segment}`);
  if (segment.length > 200) throw new InvalidPathError(`${label}过长`);
}

/** 规范化并校验相对路径 */
export function assertRelPath(rel: string): string {
  const normalized = rel.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!normalized) throw new InvalidPathError('路径不能为空');
  for (const segment of normalized.split('/')) assertSegment(segment, '路径');
  return normalized;
}

/** 解析到根目录内；越界抛 PathEscapeError，由入口层翻译成协议码 */
export function resolveInside(root: string, rel: string): string {
  const normalized = assertRelPath(rel);
  const absolute = path.resolve(root, normalized);
  if (absolute !== root && !absolute.startsWith(root + path.sep)) {
    throw new PathEscapeError('路径越界');
  }
  return absolute;
}

/** markdown 路径规范化：无扩展名时补 .md */
export function normalizeDocPath(rel: string): string {
  const normalized = assertRelPath(rel);
  return /\.(md|markdown)$/i.test(normalized) ? normalized : `${normalized}.md`;
}

/** 解析已存在的条目，缺扩展名时尝试补 .md */
export function resolveExisting(root: string, rel: string): string {
  const normalized = assertRelPath(rel);
  const direct = resolveInside(root, normalized);
  if (!existsSync(direct) && !/\.(md|markdown)$/i.test(normalized)) {
    const withExt = resolveInside(root, `${normalized}.md`);
    if (existsSync(withExt)) return withExt;
  }
  return direct;
}
