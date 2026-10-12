import path from 'node:path';
import { InvalidInputError } from '../kernel/errors';

/**
 * 文档模块对外的能力面。
 *
 * 它存在是因为 R3：跨模块只能调对方的业务层。space 的迁移、chat 的 AI 工具、
 * MCP 端点都要读写文档，只许 import 这里，不许碰 ./dao。
 *
 * dao 负责「怎么写下去」（单源读写、路径安全、原子写），这一层负责「该不该允许」。
 */

const DOC_EXTENSIONS = ['.md', '.markdown'];

/** 是不是一篇能被渲染的文档 */
export function isDocPath(rel: string): boolean {
  return DOC_EXTENSIONS.includes(path.extname(rel).toLowerCase());
}

/** 非文档一律拒绝——文档模块只认 markdown */
export function assertDocPath(rel: string): void {
  if (!isDocPath(rel)) throw new InvalidInputError('仅支持 markdown 文件');
}

export {
  appendDoc,
  createDoc,
  createFolder,
  deleteEntry,
  editDoc,
  listDocPaths,
  locate,
  readDoc,
  renameEntry,
  scanTree,
  searchDocs,
  writeDoc,
} from './dao';
export type { SearchMatch, TreeNode } from './dao';
