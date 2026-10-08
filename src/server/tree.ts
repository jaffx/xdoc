import { readdir } from 'node:fs/promises';
import path from 'node:path';

export interface TreeNode {
  name: string;
  path: string;
  type: 'dir' | 'file';
  children?: TreeNode[];
}

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', '.git', '.idea', '.vscode', '.obsidian']);
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