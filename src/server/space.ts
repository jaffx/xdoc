import { createHash } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { watch, type FSWatcher } from 'chokidar';
import { createRenderer, type XdocRenderer } from '../core/index';
import { findConfigFile, isConfigFile, loadConfig } from './config';
import type { PersistedSpace } from './persistence';

export type SpaceSource = 'cli' | 'user';

export interface SpaceInfo {
  id: string;
  name: string;
  root: string;
  source: SpaceSource;
  /** 空间备注 */
  description?: string;
  createdAt?: number;
  updatedAt?: number;
}

export type EmitFn = (event: string, data: Record<string, unknown>) => void;

const WATCHED_FILE_RE = /\.(md|markdown|png|jpe?g|gif|webp|svg|avif)$/i;

/** 由根目录生成稳定 id：目录名 + 路径哈希 */
export function spaceIdFor(root: string): string {
  const hash = createHash('sha1').update(root).digest('hex').slice(0, 6);
  const base =
    path
      .basename(root)
      .toLowerCase()
      .replace(/[^\p{L}\p{N}_-]+/gu, '-')
      .replace(/^-+|-+$/g, '') || 'space';
  return `${base}-${hash}`;
}

function isIgnored(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel.split(path.sep).some((segment) => segment.startsWith('.') || segment === 'node_modules' || segment === 'dist');
}

/** 单个空间的运行时：渲染器 + 配置 + 文件监听 + 元数据 */
export class SpaceRuntime {
  readonly info: SpaceInfo;
  renderer!: XdocRenderer;
  styles: string[] = [];
  configFile: string | null = null;
  /** 是否写入持久化注册表 */
  tracked = false;

  private watcher: FSWatcher | null = null;
  private configTimer: NodeJS.Timeout | undefined;

  constructor(info: SpaceInfo, private readonly emit: EmitFn, tracked: boolean, private readonly watching = true) {
    this.info = info;
    this.tracked = tracked;
  }

  async init(): Promise<void> {
    const config = await loadConfig(this.info.root);
    this.renderer = createRenderer({ registry: config.registry });
    this.styles = config.styles;
    this.configFile = findConfigFile(this.info.root);

    if (!this.watching) return;
    this.watcher = watch(this.info.root, {
      ignoreInitial: true,
      ignored: (target: string) => isIgnored(this.info.root, target),
    });
    this.watcher.on('all', (event, target) => this.onFileEvent(event, target));
  }

  updateMetadata(patch: { name?: string; description?: string }): SpaceInfo {
    if (patch.name !== undefined && patch.name.trim()) this.info.name = patch.name.trim();
    if (patch.description !== undefined) {
      const description = patch.description.trim();
      if (description) this.info.description = description;
      else delete this.info.description;
    }
    this.info.updatedAt = Date.now();
    this.tracked = true;
    return this.info;
  }

  private onFileEvent(event: string, target: string): void {
    const rel = path.relative(this.info.root, target).split(path.sep).join('/');
    if (isConfigFile(target)) {
      clearTimeout(this.configTimer);
      this.configTimer = setTimeout(() => void this.reloadConfig(), 150);
      return;
    }
    if (event === 'add' || event === 'unlink') {
      this.emit('tree', { space: this.info.id, event, path: rel });
    }
    if (WATCHED_FILE_RE.test(target)) {
      this.emit('change', { space: this.info.id, event, path: rel });
    }
  }

  async reloadConfig(): Promise<void> {
    try {
      const config = await loadConfig(this.info.root);
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
  root: string;
  name?: string;
  description?: string;
  source?: SpaceSource;
  createdAt?: number;
  updatedAt?: number;
  /** 是否写入持久化注册表，默认 source === 'user' */
  tracked?: boolean;
}

export class SpaceManager {
  private readonly runtimes = new Map<string, SpaceRuntime>();

  constructor(
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

  hasRoot(root: string): boolean {
    const target = path.resolve(root);
    return this.list().some((space) => space.root === target);
  }

  async add(input: AddSpaceInput): Promise<{ space: SpaceInfo; created: boolean }> {
    const root = path.resolve(input.root);
    if (!existsSync(root)) throw new Error(`目录不存在：${root}`);
    if (!statSync(root).isDirectory()) throw new Error(`不是目录：${root}`);

    const id = spaceIdFor(root);
    const existing = this.runtimes.get(id);
    if (existing) {
      if (input.tracked) existing.tracked = true;
      return { space: existing.info, created: false };
    }

    const name = this.uniqueName(input.name?.trim() || path.basename(root) || root, root);
    const runtime = new SpaceRuntime(
      {
        id,
        name,
        root,
        source: input.source ?? 'user',
        description: input.description || undefined,
        createdAt: input.createdAt,
        updatedAt: input.updatedAt,
      },
      this.emit,
      input.tracked ?? input.source === 'user',
      this.options.watch !== false,
    );
    await runtime.init();
    this.runtimes.set(id, runtime);
    return { space: runtime.info, created: true };
  }

  async remove(id: string): Promise<boolean> {
    const runtime = this.runtimes.get(id);
    if (!runtime) return false;
    this.runtimes.delete(id);
    await runtime.close();
    return true;
  }

  /** 需要写入注册表的空间（被 UI 添加或编辑过的） */
  entries(): PersistedSpace[] {
    return [...this.runtimes.values()]
      .filter((runtime) => runtime.tracked)
      .map((runtime) => ({
        root: runtime.info.root,
        name: runtime.info.name,
        description: runtime.info.description,
        createdAt: runtime.info.createdAt,
        updatedAt: runtime.info.updatedAt,
      }));
  }

  async closeAll(): Promise<void> {
    const runtimes = [...this.runtimes.values()];
    this.runtimes.clear();
    await Promise.all(runtimes.map((runtime) => runtime.close()));
  }

  private uniqueName(candidate: string, root: string): string {
    const taken = new Set(this.list().map((space) => space.name));
    if (!taken.has(candidate)) return candidate;
    const parent = path.basename(path.dirname(root));
    const preferred = parent && parent !== path.sep ? `${parent}/${candidate}` : candidate;
    if (!taken.has(preferred)) return preferred;
    let index = 2;
    while (taken.has(`${preferred} ${index}`)) index++;
    return `${preferred} ${index}`;
  }
}