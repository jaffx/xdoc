import { existsSync, statSync } from 'node:fs';
import { mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { watch, type FSWatcher } from 'chokidar';
import { createRenderer, type XdocRenderer } from '../core/index';
import { findConfigFile, isConfigFile, loadConfig } from './config';
import {
  docRootOf,
  ensureSpaceDir,
  generateSpaceId,
  isMetaFile,
  writeMeta,
  type SpaceMeta,
  type SpaceMetaSeed,
} from './meta';
import { slugify, spacesDirOf, trashDirOf, uniqueSlug } from './root';

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

/** 剥掉 dir / docRoot / slug，避免把宿主机路径泄露到前端 */
export function publicSpace(info: SpaceInfo): PublicSpaceInfo {
  const result: PublicSpaceInfo = { id: info.id, name: info.name };
  if (info.description) result.description = info.description;
  if (info.createdAt !== undefined) result.createdAt = info.createdAt;
  if (info.updatedAt !== undefined) result.updatedAt = info.updatedAt;
  return result;
}

export type EmitFn = (event: string, data: Record<string, unknown>) => void;

const WATCHED_FILE_RE = /\.(md|markdown|png|jpe?g|gif|webp|svg|avif)$/i;
const TREE_EVENTS = new Set(['add', 'unlink', 'addDir', 'unlinkDir']);

function isIgnored(dir: string, target: string): boolean {
  const rel = path.relative(dir, target);
  return rel.split(path.sep).some((segment) => segment.startsWith('.') || segment === 'node_modules' || segment === 'dist');
}

/** 目标是否位于文档根目录内 */
function isInside(root: string, target: string): boolean {
  return target === root || target.startsWith(root + path.sep);
}

/** 单个空间的运行时：渲染器 + 配置 + 文件监听 + 元数据 */
export class SpaceRuntime {
  readonly info: SpaceInfo;
  renderer!: XdocRenderer;
  styles: string[] = [];
  configFile: string | null = null;

  private watcher: FSWatcher | null = null;
  private configTimer: NodeJS.Timeout | undefined;

  constructor(info: SpaceInfo, private readonly emit: EmitFn, private readonly watching = true) {
    this.info = info;
  }

  async init(): Promise<void> {
    const config = await loadConfig(this.info.dir);
    this.renderer = createRenderer({ registry: config.registry });
    this.styles = config.styles;
    this.configFile = findConfigFile(this.info.dir);

    if (!this.watching) return;
    this.watcher = watch(this.info.dir, {
      ignoreInitial: true,
      ignored: (target: string) => isIgnored(this.info.dir, target),
    });
    this.watcher.on('all', (event, target) => this.onFileEvent(event, target));
  }

  async updateMetadata(patch: { name?: string; description?: string }): Promise<SpaceInfo> {
    if (patch.name !== undefined && patch.name.trim()) this.info.name = patch.name.trim();
    if (patch.description !== undefined) {
      const description = patch.description.trim();
      if (description) this.info.description = description;
      else delete this.info.description;
    }
    this.info.updatedAt = Date.now();
    await this.persistMeta();
    return this.info;
  }

  /** 把当前元数据写回空间目录的 meta.json */
  async persistMeta(): Promise<void> {
    const meta: SpaceMeta = {
      id: this.info.id,
      name: this.info.name,
      createdAt: this.info.createdAt ?? Date.now(),
      updatedAt: this.info.updatedAt ?? Date.now(),
    };
    if (this.info.description) meta.description = this.info.description;
    try {
      await writeMeta(this.info.dir, meta);
    } catch (error) {
      console.warn(`[xdoc] [${this.info.name}] meta.json 写入失败：`, error instanceof Error ? error.message : error);
    }
  }

  private onFileEvent(event: string, target: string): void {
    if (isConfigFile(target)) {
      clearTimeout(this.configTimer);
      this.configTimer = setTimeout(() => void this.reloadConfig(), 150);
      return;
    }
    // meta.json 由服务端自己写入，忽略以避免回环
    if (isMetaFile(target)) return;
    // 空间根下的其他文件（如后续扩展目录）不参与文档事件
    if (!isInside(this.info.docRoot, target)) return;

    const rel = path.relative(this.info.docRoot, target).split(path.sep).join('/');
    if (TREE_EVENTS.has(event)) {
      this.emit('tree', { space: this.info.id, event, path: rel });
    }
    if (WATCHED_FILE_RE.test(target)) {
      this.emit('change', { space: this.info.id, event, path: rel });
    }
  }

  async reloadConfig(): Promise<void> {
    try {
      const config = await loadConfig(this.info.dir);
      this.renderer = createRenderer({ registry: config.registry });
      this.styles = config.styles;
      this.emit('config', { space: this.info.id, path: config.loaded });
      console.log(`[xdoc] [${this.info.name}] 配置已重新加载：${config.registry.names().join(', ')}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.emit('config-error', { space: this.info.id, message });
      console.error(`[xdoc] [${this.info.name}] 配置加载失败：${message}`);
    }
  }

  async close(): Promise<void> {
    clearTimeout(this.configTimer);
    await this.watcher?.close();
    this.watcher = null;
  }
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

export class SpaceManager {
  private readonly runtimes = new Map<string, SpaceRuntime>();

  constructor(
    readonly root: string,
    private readonly emit: EmitFn,
    private readonly options: { watch?: boolean } = {},
  ) {}

  list(): SpaceInfo[] {
    return [...this.runtimes.values()].map((runtime) => runtime.info);
  }

  get(id: string): SpaceRuntime | undefined {
    return this.runtimes.get(id);
  }

  default(): SpaceRuntime | undefined {
    return this.runtimes.values().next().value;
  }

  hasDir(dir: string): boolean {
    const target = path.resolve(dir);
    return this.list().some((space) => space.dir === target);
  }

  /** 当前空间的展示顺序（目录名），写入 index.json */
  order(): string[] {
    return this.list().map((space) => space.slug);
  }

  /** 装载 <root>/spaces 下已存在的空间目录 */
  async add(input: AddSpaceInput): Promise<AddSpaceResult> {
    const dir = path.resolve(input.dir);
    if (existsSync(dir) && !statSync(dir).isDirectory()) throw new Error(`不是目录：${dir}`);

    const existing = this.list().find((space) => space.dir === dir);
    if (existing) {
      return { space: this.runtimes.get(existing.id)!.info, created: false, migrated: 0, initialized: false };
    }

    const { meta, migrated, initialized } = await ensureSpaceDir(dir, input.seed ?? {});

    // 直接拷贝空间目录会带来重复 id，重新生成并回写
    let id = meta.id;
    if (this.runtimes.has(id)) {
      id = generateSpaceId();
      await writeMeta(dir, { ...meta, id });
    }

    const runtime = new SpaceRuntime(
      {
        id,
        name: this.uniqueName(meta.name),
        slug: path.basename(dir),
        dir,
        docRoot: docRootOf(dir),
        description: meta.description,
        createdAt: meta.createdAt,
        updatedAt: meta.updatedAt,
      },
      this.emit,
      this.options.watch !== false,
    );
    await runtime.init();
    this.runtimes.set(id, runtime);
    return { space: runtime.info, created: true, migrated, initialized };
  }

  /** 按名称在 <root>/spaces 下新建空间，目录名由名称派生 */
  async create(input: CreateSpaceInput): Promise<AddSpaceResult> {
    const name = input.name.trim();
    if (!name) throw new Error('空间名称不能为空');

    const spacesDir = spacesDirOf(this.root);
    await mkdir(spacesDir, { recursive: true });
    const slug = uniqueSlug(spacesDir, slugify(name));

    const seed: SpaceMetaSeed = { name };
    if (input.description?.trim()) seed.description = input.description.trim();
    return this.add({ dir: path.join(spacesDir, slug), seed });
  }

  /**
   * 移除空间：空间目录移入 <root>/trash/，而不是从磁盘删掉。
   * 空间现在是扫描 <root>/spaces 发现的，若只摘掉运行时，下次启动会原样回来。
   */
  async remove(id: string): Promise<string | null> {
    const runtime = this.runtimes.get(id);
    if (!runtime) return null;
    this.runtimes.delete(id);
    await runtime.close();

    const trashDir = trashDirOf(this.root);
    await mkdir(trashDir, { recursive: true });
    const target = path.join(trashDir, `${runtime.info.slug}-${Date.now()}`);
    await rename(runtime.info.dir, target);
    return target;
  }

  async closeAll(): Promise<void> {
    const runtimes = [...this.runtimes.values()];
    this.runtimes.clear();
    await Promise.all(runtimes.map((runtime) => runtime.close()));
  }

  /** 展示名去重，仅作用于内存，不回写 meta.json */
  private uniqueName(candidate: string): string {
    const taken = new Set(this.list().map((space) => space.name));
    if (!taken.has(candidate)) return candidate;
    let index = 2;
    while (taken.has(`${candidate} ${index}`)) index++;
    return `${candidate} ${index}`;
  }
}
