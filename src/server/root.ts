import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expandHome } from './operations';

/**
 * 数据根目录（root）结构：
 *
 *   <root>/
 *   ├── index.json        # 跨空间索引：顺序、上次活跃空间
 *   ├── config.json       # 部署参数：token / host / port / cert / key（可选）
 *   ├── spaces/           # 每个子目录是一个空间
 *   │   └── <slug>/       # meta.json + xdoc.config.ts + doc/
 *   └── trash/            # 被移除的空间（不删用户文档）
 *
 * root 由 CLI 参数或 XDOC_ROOT 指定，默认 ~/.xdoc，位于仓库之外，
 * 因此用户文档不会随 xdoc 自身的 git 提交。
 */
const SPACES_DIR = 'spaces';
const TRASH_DIR = 'trash';
const CONFIG_FILE = 'config.json';

/** <root>/config.json：部署参数写在这里，省得每次启动都敲一长串选项 */
export interface Settings {
  /** 访问令牌。设置了就要求 Bearer 令牌才能调用 /api/* 与 /mcp */
  token?: string;
  host?: string;
  port?: number;
  /** TLS 证书与私钥路径（PEM），相对路径按数据根目录解析 */
  cert?: string;
  key?: string;
}

/**
 * 读取 <root>/config.json。文件不存在返回空配置；
 * 存在但读不动则直接报错——静默忽略会让「配了等于没配」变得很难查。
 */
export function loadSettings(root: string): Settings {
  const file = path.join(root, CONFIG_FILE);
  if (!existsSync(file)) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`读取 ${file} 失败：${error instanceof Error ? error.message : String(error)}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${file} 应该是一个 JSON 对象`);
  }
  const raw = parsed as Record<string, unknown>;
  const settings: Settings = {};
  if (typeof raw.token === 'string' && raw.token.trim()) settings.token = raw.token.trim();
  if (typeof raw.host === 'string' && raw.host.trim()) settings.host = raw.host.trim();
  if (typeof raw.port === 'number' && Number.isInteger(raw.port) && raw.port > 0) settings.port = raw.port;
  const resolve = (value: unknown) =>
    typeof value === 'string' && value.trim() ? path.resolve(root, expandHome(value.trim())) : undefined;
  settings.cert = resolve(raw.cert);
  settings.key = resolve(raw.key);
  return settings;
}

/** 解析数据根目录：显式参数 > XDOC_ROOT > ~/.xdoc */
export function resolveRoot(explicit?: string): string {
  const candidate = explicit?.trim() || process.env.XDOC_ROOT?.trim();
  if (candidate) return path.resolve(expandHome(candidate));
  return path.join(os.homedir(), '.xdoc');
}

export function spacesDirOf(root: string): string {
  return path.join(root, SPACES_DIR);
}

export function trashDirOf(root: string): string {
  return path.join(root, TRASH_DIR);
}

/**
 * 空间名称转目录名：保留 unicode 字母与数字（中文名可直接作目录名），
 * 其余字符压成单个 `-`。
 */
export function slugify(name: string): string {
  const slug = name
    .trim()
    .replace(/[^\p{L}\p{N}_-]+/gu, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|-+$/g, '')
    .slice(0, 60);
  return slug || 'space';
}

/** 目录已被占用时追加 -2、-3 */
export function uniqueSlug(spacesDir: string, base: string): string {
  if (!existsSync(path.join(spacesDir, base))) return base;
  let index = 2;
  while (existsSync(path.join(spacesDir, `${base}-${index}`))) index++;
  return `${base}-${index}`;
}

/** 列出 spaces/ 下的空间目录名（忽略 . 开头） */
export async function listSpaceSlugs(root: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(spacesDirOf(root), { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

/**
 * 补一份默认 config.json，默认就是「挂到服务器上能直接用」的样子：监听 0.0.0.0、
 * 不设令牌——本地浏览器打开就能看，不用先配任何东西。
 *
 * 不写 port：写进去等于"显式指定端口"，会让「端口被占用自动 +1」失效。
 * 已有文件一律不动，因此本地老 root 的行为不受影响。要鉴权就往里加 token；
 * 文件里可能有令牌，建成 0600。
 */
async function ensureConfigFile(root: string): Promise<void> {
  const file = path.join(root, CONFIG_FILE);
  if (existsSync(file)) return;
  const settings: Settings = { host: '0.0.0.0' };
  await writeFile(file, `${JSON.stringify(settings, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
}

/**
 * 幂等地准备好 root：建出 spaces/ 与默认 config.json。
 *
 * 不植入任何示例空间——起来就是一个空的空间列表，要什么在网页里建。
 */
export async function ensureRoot(root: string): Promise<void> {
  await mkdir(spacesDirOf(root), { recursive: true });
  await ensureConfigFile(root);
}
