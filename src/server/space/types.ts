import type { SpaceMetaSeed } from './dao';

/**
 * 空间模块的领域类型。多层共用，故独立成单元——manager 用它描述运行时持有的空间，
 * service 用它描述对外承诺，ctrl 用它描述协议载荷。
 */

/** 一个空间的完整身份 */
export interface SpaceInfo {
  id: string;
  name: string;
  /** 空间目录名，即 <root>/spaces 下的子目录名 */
  slug: string;
  /** 空间目录：存放 meta.json 与 xdoc.config.ts */
  dir: string;
  /** 文档根目录，恒为 <dir>/doc */
  docRoot: string;
  /** 空间备注 */
  description?: string;
  createdAt?: number;
  updatedAt?: number;
}

/** 对外（浏览器）暴露的空间信息：不含任何文件系统路径 */
export interface PublicSpaceInfo {
  id: string;
  name: string;
  description?: string;
  createdAt?: number;
  updatedAt?: number;
}

export interface AddSpaceInput {
  /** 空间目录，必须位于 <root>/spaces 下；不存在时会被创建并初始化 */
  dir: string;
  /** 初始化 meta.json 时带入的元数据 */
  seed?: SpaceMetaSeed;
}

export interface CreateSpaceInput {
  name: string;
  description?: string;
}

export interface AddSpaceResult {
  space: SpaceInfo;
  created: boolean;
  /** 迁移进 doc/ 的顶层条目数 */
  migrated: number;
  /** 是否首次初始化（生成了 meta.json） */
  initialized: boolean;
}
