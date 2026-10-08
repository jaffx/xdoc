import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { createRegistry, type EmbedDefinition, type EmbedRegistry } from '../core/index';

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