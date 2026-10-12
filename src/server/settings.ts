import { existsSync, readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadSettings, type AiSettings } from './root';

const CONFIG_FILE = 'config.json';

/** opencode 的配置文件。xdoc 的 AI 配置早先只认这一份，老配置继续兜底读 */
const OPENCODE_CONFIG = path.join(os.homedir(), '.config', 'opencode', 'opencode.json');

/** AI 配置的来路，面板上照实告诉用户 */
export type AiSource = 'xdoc' | 'opencode' | 'none';

/** 设置面板看到的样子：密钥一律只给掩码，真值不出进程 */
export interface PublicSettings {
  ai: {
    hasApiKey: boolean;
    /** 形如 sk-a••••3f9d；没配就是空串 */
    apiKeyMask: string;
    baseURL: string;
    model: string;
    source: AiSource;
  };
  token: {
    hasToken: boolean;
    tokenMask: string;
  };
}

/** 面板提交的改动。字段缺省 = 不改；空串 = 清掉 */
export interface SettingsPatch {
  ai?: { apiKey?: string; baseURL?: string; model?: string };
  token?: string;
}

function maskSecret(secret: string): string {
  if (!secret) return '';
  // 太短的掩了就什么都不剩，干脆全掩
  if (secret.length <= 8) return '•'.repeat(secret.length);
  return `${secret.slice(0, 4)}••••${secret.slice(-4)}`;
}

function readRawConfig(file: string): Record<string, unknown> {
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
  return parsed as Record<string, unknown>;
}

/**
 * <root>/config.json 的读写口。
 *
 * 读经过 root.ts 的 loadSettings（解析 + 相对路径展开），写则直接改文件里的原始
 * JSON——把解析后的绝对路径写回去，会把用户写的相对路径固化下来。
 */
export class SettingsStore {
  readonly root: string;
  /**
   * 令牌在内存里留一份：面板改完立刻生效，写文件只是为了让重启后还在。
   * 启动时带的是命令行 / 环境变量 / config.json 里优先的那个。
   */
  #token: string;

  constructor(root: string, token = '') {
    this.root = root;
    this.#token = token;
  }

  get configPath(): string {
    return path.join(this.root, CONFIG_FILE);
  }

  get token(): string {
    return this.#token;
  }

  /** AI 配置：xdoc 自己的写在前面，没有 key 时回退到 opencode 那份 */
  resolveAi(): { settings: AiSettings; source: AiSource } {
    const own = loadSettings(this.root).ai;
    if (own?.apiKey) return { settings: own, source: 'xdoc' };

    const fallback = this.#fromOpencode();
    if (fallback?.apiKey) {
      // 字段级合并：model / baseURL 只在 xdoc 里写过的话也算数
      return { settings: { ...fallback, ...own }, source: 'opencode' };
    }
    return { settings: own ?? {}, source: own ? 'xdoc' : 'none' };
  }

  publicView(): PublicSettings {
    const { settings, source } = this.resolveAi();
    const apiKey = settings.apiKey ?? '';
    return {
      ai: {
        hasApiKey: Boolean(apiKey),
        apiKeyMask: maskSecret(apiKey),
        baseURL: settings.baseURL ?? '',
        model: settings.model ?? '',
        source,
      },
      token: {
        hasToken: Boolean(this.#token),
        tokenMask: maskSecret(this.#token),
      },
    };
  }

  /** 合并写入：只动传进来的字段，空串表示删掉该字段 */
  async update(patch: SettingsPatch): Promise<PublicSettings> {
    const raw = readRawConfig(this.configPath);

    if (patch.ai) {
      // 直接铺开原始对象而不是用解析结果：ai 段里将来多出来的字段不该被写没
      const current = raw.ai && typeof raw.ai === 'object' && !Array.isArray(raw.ai) ? (raw.ai as Record<string, unknown>) : {};
      const ai = { ...current };
      for (const key of ['apiKey', 'baseURL', 'model'] as const) {
        const value = patch.ai[key];
        if (value === undefined) continue;
        const next = value.trim();
        if (next) ai[key] = next;
        else delete ai[key];
      }
      if (Object.keys(ai).length > 0) raw.ai = ai;
      else delete raw.ai;
    }

    if (patch.token !== undefined) {
      const next = patch.token.trim();
      this.#token = next;
      if (next) raw.token = next;
      else delete raw.token;
    }

    await writeFile(this.configPath, `${JSON.stringify(raw, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    return this.publicView();
  }

  /** 从 opencode 配置里捞一份兜底；格式不对或读不动就当没有，不影响 xdoc 启动 */
  #fromOpencode(): AiSettings | undefined {
    if (!existsSync(OPENCODE_CONFIG)) return undefined;
    try {
      const raw = JSON.parse(readFileSync(OPENCODE_CONFIG, 'utf8')) as {
        provider?: Record<
          string,
          { npm?: string; options?: { baseURL?: string; apiKey?: string }; models?: Record<string, unknown> }
        >;
      };
      const provider = Object.values(raw.provider ?? {})[0];
      if (!provider || provider.npm !== '@ai-sdk/anthropic') return undefined;

      const ai: AiSettings = {};
      if (provider.options?.apiKey) ai.apiKey = provider.options.apiKey;
      if (provider.options?.baseURL) ai.baseURL = provider.options.baseURL;
      // models 里常有一个 'auto' 占位，选具体那个
      const model = Object.keys(provider.models ?? {}).find((name) => name !== 'auto');
      if (model) ai.model = model;
      return ai.apiKey ? ai : undefined;
    } catch {
      return undefined;
    }
  }
}
