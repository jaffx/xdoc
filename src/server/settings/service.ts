import { loadSettings, type AiSettings } from '../kernel/root';
import { configPathOf, readOpencodeAi, readRawConfig, writeRawConfig } from './dao';

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

/**
 * <root>/config.json 的读写口。
 *
 * 掩码怎么给、缺省与空串怎么区分、opencode 那份怎么兜底——都是业务规则，不是存储。
 * 读写原始 JSON 的两件事在 ./dao。
 */
export class SrvcSettings {
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
    return configPathOf(this.root);
  }

  get token(): string {
    return this.#token;
  }

  /** AI 配置：xdoc 自己的写在前面，没有 key 时回退到 opencode 那份 */
  resolveAi(): { settings: AiSettings; source: AiSource } {
    const own = loadSettings(this.root).ai;
    if (own?.apiKey) return { settings: own, source: 'xdoc' };

    const fallback = readOpencodeAi();
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
      const current =
        raw.ai && typeof raw.ai === 'object' && !Array.isArray(raw.ai) ? (raw.ai as Record<string, unknown>) : {};
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

    await writeRawConfig(this.configPath, raw);
    return this.publicView();
  }
}
