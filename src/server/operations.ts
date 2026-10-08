import { existsSync, statSync } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { listDocPaths } from './tree';

/** 带 HTTP 状态码的操作错误 */
export class OperationError extends Error {
  constructor(
    message: string,
    readonly statusCode = 400,
  ) {
    super(message);
  }
}

const SEGMENT_RE = /^[^/\\<>:"|?*\u0000-\u001f]+$/;

/** 展开 ~ 开头的路径 */
export function expandHome(input: string): string {
  if (input === '~') return os.homedir();
  if (input.startsWith('~/') || input.startsWith('~\\')) return path.join(os.homedir(), input.slice(2));
  return input;
}

/** 校验单个路径片段（目录名/文件名） */
export function assertSegment(segment: string, label = '名称'): void {
  if (segment === '..') throw new OperationError('路径越界', 403);
  if (!segment || segment === '.') throw new OperationError(`${label}不能为空`);
  if (segment.startsWith('.')) throw new OperationError(`${label}不能以 . 开头`);
  if (!SEGMENT_RE.test(segment)) throw new OperationError(`${label}包含非法字符：${segment}`);
  if (segment.length > 200) throw new OperationError(`${label}过长`);
}

/** 规范化并校验相对路径 */
export function assertRelPath(rel: string): string {
  const normalized = rel.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!normalized) throw new OperationError('路径不能为空');
  for (const segment of normalized.split('/')) assertSegment(segment, '路径');
  return normalized;
}

/** 安全解析到根目录内，越界抛 403 */
export function resolveInside(root: string, rel: string): string {
  const normalized = assertRelPath(rel);
  const absolute = path.resolve(root, normalized);
  if (absolute !== root && !absolute.startsWith(root + path.sep)) {
    throw new OperationError('路径越界', 403);
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

/** 新建目录（支持多级路径） */
export async function createFolder(root: string, rel: string): Promise<string> {
  const normalized = assertRelPath(rel);
  const absolute = resolveInside(root, normalized);
  if (existsSync(absolute)) throw new OperationError(`已存在：${normalized}`, 409);
  await mkdir(absolute, { recursive: true });
  return normalized;
}

/** 新建文档（默认生成标题），已存在则 409 */
export async function createDoc(root: string, rel: string, content?: string): Promise<string> {
  const normalized = normalizeDocPath(rel);
  const absolute = resolveInside(root, normalized);
  if (existsSync(absolute)) throw new OperationError(`文件已存在：${normalized}`, 409);
  await mkdir(path.dirname(absolute), { recursive: true });
  const title = path.basename(normalized).replace(/\.(md|markdown)$/i, '');
  await writeFile(absolute, content ?? `# ${title}\n`);
  return normalized;
}

/** 覆盖写入文档（不存在则创建） */
export async function writeDoc(root: string, rel: string, content: string): Promise<string> {
  const normalized = normalizeDocPath(rel);
  const absolute = resolveInside(root, normalized);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, content.endsWith('\n') ? content : `${content}\n`);
  return normalized;
}

/** 追加内容到文档末尾 */
export async function appendDoc(root: string, rel: string, content: string): Promise<string> {
  const normalized = normalizeDocPath(rel);
  const absolute = resolveInside(root, normalized);
  if (!existsSync(absolute)) return writeDoc(root, normalized, content);
  const current = (await readFile(absolute, 'utf8')).replace(/\s+$/, '');
  const trimmed = content.trim();
  await writeFile(absolute, `${current ? `${current}\n\n` : ''}${trimmed}\n`);
  return normalized;
}

/** 精确文本替换，返回替换次数 */
export async function editDoc(
  root: string,
  rel: string,
  oldText: string,
  newText: string,
  replaceAll = false,
): Promise<{ path: string; replacements: number }> {
  if (!oldText) throw new OperationError('old_text 不能为空');
  const absolute = resolveExisting(root, rel);
  if (!existsSync(absolute)) throw new OperationError(`文件不存在：${rel}`, 404);
  const source = await readFile(absolute, 'utf8');
  const count = source.split(oldText).length - 1;
  if (count === 0) throw new OperationError('未找到要替换的文本，请先 read_doc 确认内容');
  if (count > 1 && !replaceAll) {
    throw new OperationError(`匹配到 ${count} 处文本，请提供更精确的 old_text，或设置 replace_all=true`);
  }
  await writeFile(absolute, source.split(oldText).join(newText));
  return { path: path.relative(root, absolute).split(path.sep).join('/'), replacements: count };
}

/** 重命名 / 移动文件或目录，返回新的相对路径 */
export async function renameEntry(root: string, from: string, to: string): Promise<string> {
  const fromAbsolute = resolveExisting(root, from);
  if (!existsSync(fromAbsolute)) throw new OperationError(`不存在：${from}`, 404);
  const info = statSync(fromAbsolute);
  let target = assertRelPath(to);
  if (info.isFile() && /\.(md|markdown)$/i.test(path.basename(fromAbsolute)) && !path.extname(path.basename(target))) {
    target = `${target}.md`;
  }
  const toAbsolute = resolveInside(root, target);
  if (toAbsolute === fromAbsolute) throw new OperationError('新旧路径相同');
  if (info.isDirectory() && (toAbsolute === fromAbsolute || toAbsolute.startsWith(fromAbsolute + path.sep))) {
    throw new OperationError('不能把目录移动到自身内部');
  }
  if (existsSync(toAbsolute)) throw new OperationError(`目标已存在：${target}`, 409);
  await mkdir(path.dirname(toAbsolute), { recursive: true });
  await rename(fromAbsolute, toAbsolute);
  return target;
}

/** 删除文件，或递归删除目录（需 recursive=true） */
export async function deleteEntry(root: string, rel: string, recursive = false): Promise<string> {
  const absolute = resolveExisting(root, rel);
  let info;
  try {
    info = await stat(absolute);
  } catch {
    throw new OperationError(`不存在：${rel}`, 404);
  }
  if (info.isDirectory()) {
    if (!recursive) throw new OperationError('删除目录需要 recursive=true');
    await rm(absolute, { recursive: true, force: true });
  } else {
    await unlink(absolute);
  }
  return rel;
}

export interface SearchMatch {
  path: string;
  line: number;
  text: string;
}

/** 全空间内容检索 */
export async function searchDocs(
  root: string,
  query: string,
  options: { regex?: boolean; caseSensitive?: boolean; limit?: number } = {},
): Promise<SearchMatch[]> {
  if (!query) throw new OperationError('query 不能为空');
  const limit = options.limit && options.limit > 0 ? Math.min(options.limit, 500) : 50;
  let pattern: RegExp | null = null;
  if (options.regex) {
    try {
      pattern = new RegExp(query, options.caseSensitive ? '' : 'i');
    } catch (error) {
      throw new OperationError(`正则表达式无效：${error instanceof Error ? error.message : error}`);
    }
  }
  const needle = options.caseSensitive ? query : query.toLowerCase();
  const matches: SearchMatch[] = [];

  for (const rel of await listDocPaths(root)) {
    const content = await readFile(path.join(root, rel), 'utf8');
    const lines = content.split('\n');
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      const hit = pattern ? pattern.test(line) : (options.caseSensitive ? line : line.toLowerCase()).includes(needle);
      if (!hit) continue;
      matches.push({ path: rel, line: index + 1, text: line.trim().slice(0, 300) });
      if (matches.length >= limit) return matches;
    }
  }
  return matches;
}

/** 读取文档内容 */
export async function readDoc(root: string, rel: string): Promise<{ path: string; content: string }> {
  const absolute = resolveExisting(root, rel);
  if (!existsSync(absolute)) throw new OperationError(`文件不存在：${rel}`, 404);
  const content = await readFile(absolute, 'utf8');
  return { path: path.relative(root, absolute).split(path.sep).join('/'), content };
}

