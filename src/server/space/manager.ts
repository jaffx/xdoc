import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { watch, type FSWatcher } from 'chokidar';
import { build } from 'esbuild';
import { createRegistry, createRenderer, type EmbedDefinition, type EmbedRegistry, type XdocRenderer } from '../../core/index';
import { createAssetService, type AssetService } from '../assets/service';
import { isMetaFile, writeMeta, type SpaceMeta } from './dao';
import type { SpaceInfo } from './types';


export interface ConfigState {
  registry: EmbedRegistry;
  styles: string[];
  /** 配置文件相对 root 的路径，未加载时为 null */
  loaded: string | null;
}

export interface ConfigApi {
  /** 注册自定义嵌入体：语法 + 渲染逻辑 */
  registerEmbed: (definition: EmbedDefinition) => void;
  /** 注入自定义 CSS，会合并进页面 */
  addStyles: (css: string) => void;
  registry: EmbedRegistry;
}

const CONFIG_FILES = ['xdoc.config.ts', 'xdoc.config.mts', 'xdoc.config.js', 'xdoc.config.mjs'];

export function isConfigFile(file: string): boolean {
  return CONFIG_FILES.includes(path.basename(file));
}

export function findConfigFile(root: string): string | null {
  for (const name of CONFIG_FILES) {
    const candidate = path.join(root, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * 加载 xdoc.config.ts|js：
 * - TS 配置会先用 esbuild 编译为临时 ESM 文件再 import
 * - 默认导出（或 setup）会以 ConfigApi 作为参数调用
 * - 也支持具名导出 embeds / styles
 */
export async function loadConfig(root: string): Promise<ConfigState> {
  const registry = createRegistry();
  const styles: string[] = [];
  const file = findConfigFile(root);
  if (!file) return { registry, styles, loaded: null };

  let importPath = file;
  if (/\.(ts|mts)$/.test(file)) {
    const hash = createHash('sha1').update(file).digest('hex').slice(0, 12);
    const outfile = path.join(os.tmpdir(), `xdoc-config-${hash}.mjs`);
    await build({
      entryPoints: [file],
      outfile,
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node18',
      logLevel: 'silent',
      sourcemap: 'inline',
    });
    importPath = outfile;
  }

  const module = (await import(`${pathToFileURL(importPath).href}?v=${Date.now()}`)) as Record<string, unknown>;
  const api: ConfigApi = {
    registerEmbed: (definition) => registry.register(definition),
    addStyles: (css) => styles.push(css),
    registry,
  };

  const setup = module.default ?? module.setup;
  if (typeof setup === 'function') {
    await (setup as (api: ConfigApi) => unknown)(api);
  } else if (typeof setup === 'object' && setup !== null) {
    const definition = setup as EmbedDefinition;
    if (definition.name && typeof definition.render === 'function') registry.register(definition);
  }

  if (Array.isArray(module.embeds)) {
    for (const embed of module.embeds as EmbedDefinition[]) registry.register(embed);
  }
  if (typeof module.styles === 'string') styles.push(module.styles);
  if (Array.isArray(module.styles)) styles.push(...(module.styles as string[]));

  return { registry, styles, loaded: path.relative(root, file) };
}

export function readConfigSource(root: string): string | null {
  const file = findConfigFile(root);
  if (!file) return null;
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
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
export class MgrSpaceRuntime {
  readonly info: SpaceInfo;
  renderer!: XdocRenderer;
  styles: string[] = [];
  configFile: string | null = null;
  assets!: AssetService;

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
    this.assets = createAssetService(this.info.dir);

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
