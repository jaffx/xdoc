import { existsSync, statSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { SKIP_DIRS, assertRelPath, normalizeDocPath, resolveExisting, resolveInside } from '../kernel/paths';
import { ConflictError, InvalidInputError, NotFoundError } from '../kernel/errors';
export interface TreeNode {
  name: string;
  path: string;
  type: 'dir' | 'file';
  children?: TreeNode[];
}

const MD_EXTENSIONS = new Set(['.md', '.markdown']);

export async function scanTree(root: string, rel = ''): Promise<TreeNode[]> {
  const absolute = path.join(root, rel);
  let entries;
  try {
    entries = await readdir(absolute, { withFileTypes: true });
  } catch {
    return [];
  }

  const dirs: TreeNode[] = [];
  const files: TreeNode[] = [];

  for (const entry of entries) {
    if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
    const childRel = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      dirs.push({ name: entry.name, path: childRel, type: 'dir', children: await scanTree(root, childRel) });
    } else if (entry.isFile() && MD_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      files.push({ name: entry.name, path: childRel, type: 'file' });
    }
  }

  const compare = (a: TreeNode, b: TreeNode) =>
    a.name.localeCompare(b.name, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' });
  dirs.sort(compare);
  files.sort(compare);
  // 文件夹与文件统一按名称排序
  return [...dirs, ...files].sort(compare);
}

/** 展平为 markdown 相对路径列表 */
export async function listDocPaths(root: string): Promise<string[]> {
  const paths: string[] = [];
  const walk = (nodes: TreeNode[]) => {
    for (const node of nodes) {
      if (node.type === 'dir') walk(node.children ?? []);
      else paths.push(node.path);
    }
  };
  walk(await scanTree(root));
  return paths;
}

/** 新建目录（支持多级路径） */
export async function createFolder(root: string, rel: string): Promise<string> {
  const normalized = assertRelPath(rel);
  const absolute = resolveInside(root, normalized);
  if (existsSync(absolute)) throw new ConflictError(`已存在：${normalized}`);
  await mkdir(absolute, { recursive: true });
  return normalized;
}

/** 新建文档（默认生成标题），已存在则 409 */
export async function createDoc(root: string, rel: string, content?: string): Promise<string> {
  const normalized = normalizeDocPath(rel);
  const absolute = resolveInside(root, normalized);
  if (existsSync(absolute)) throw new ConflictError(`文件已存在：${normalized}`);
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
  if (!oldText) throw new InvalidInputError('old_text 不能为空');
  const absolute = resolveExisting(root, rel);
  if (!existsSync(absolute)) throw new NotFoundError(`文件不存在：${rel}`);
  const source = await readFile(absolute, 'utf8');
  const count = source.split(oldText).length - 1;
  if (count === 0) throw new InvalidInputError('未找到要替换的文本，请先 read_doc 确认内容');
  if (count > 1 && !replaceAll) {
    throw new InvalidInputError(`匹配到 ${count} 处文本，请提供更精确的 old_text，或设置 replace_all=true`);
  }
  await writeFile(absolute, source.split(oldText).join(newText));
  return { path: path.relative(root, absolute).split(path.sep).join('/'), replacements: count };
}

/** 重命名 / 移动文件或目录，返回新的相对路径 */
export async function renameEntry(root: string, from: string, to: string): Promise<string> {
  const fromAbsolute = resolveExisting(root, from);
  if (!existsSync(fromAbsolute)) throw new NotFoundError(`不存在：${from}`);
  const info = statSync(fromAbsolute);
  let target = assertRelPath(to);
  if (info.isFile() && /\.(md|markdown)$/i.test(path.basename(fromAbsolute)) && !path.extname(path.basename(target))) {
    target = `${target}.md`;
  }
  const toAbsolute = resolveInside(root, target);
  if (toAbsolute === fromAbsolute) throw new InvalidInputError('新旧路径相同');
  if (info.isDirectory() && (toAbsolute === fromAbsolute || toAbsolute.startsWith(fromAbsolute + path.sep))) {
    throw new InvalidInputError('不能把目录移动到自身内部');
  }
  if (existsSync(toAbsolute)) throw new ConflictError(`目标已存在：${target}`);
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
    throw new NotFoundError(`不存在：${rel}`);
  }
  if (info.isDirectory()) {
    if (!recursive) throw new InvalidInputError('删除目录需要 recursive=true');
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
  if (!query) throw new InvalidInputError('query 不能为空');
  const limit = options.limit && options.limit > 0 ? Math.min(options.limit, 500) : 50;
  let pattern: RegExp | null = null;
  if (options.regex) {
    try {
      pattern = new RegExp(query, options.caseSensitive ? '' : 'i');
    } catch (error) {
      throw new InvalidInputError(`正则表达式无效：${error instanceof Error ? error.message : error}`);
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

/**
 * 定位一个已存在的文件，返回它的绝对路径（图片、附件这类不经渲染的读取用）。
 *
 * 「在不在」是存储层的事实，所以缺文件这件事在这里定性成 NotFoundError，
 * 入口层不再自己 existsSync 一遍再手搓 404。
 */
export async function locate(root: string, rel: string): Promise<string> {
  const absolute = resolveInside(root, rel);
  if (!existsSync(absolute)) throw new NotFoundError(`文件不存在：${rel}`);
  return absolute;
}

/** 读取文档内容 */
export async function readDoc(root: string, rel: string): Promise<{ path: string; content: string }> {
  const absolute = resolveExisting(root, rel);
  if (!existsSync(absolute)) throw new NotFoundError(`文件不存在：${rel}`);
  const content = await readFile(absolute, 'utf8');
  return { path: path.relative(root, absolute).split(path.sep).join('/'), content };
}
