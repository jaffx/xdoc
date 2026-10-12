import { existsSync, readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AiSettings } from '../kernel/root';

/** 设置面板的落盘位置 */
export const CONFIG_FILE = 'config.json';

/** opencode 的配置文件。xdoc 的 AI 配置早先只认这一份，老配置继续兜底读 */
const OPENCODE_CONFIG = path.join(os.homedir(), '.config', 'opencode', 'opencode.json');

export function configPathOf(root: string): string {
  return path.join(root, CONFIG_FILE);
}

/** 读原始 JSON（不解析成模型），写回时才能保住不认识的字段 */
export function readRawConfig(file: string): Record<string, unknown> {
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

/** 令牌属于凭据，落到文件上收紧权限 */
export async function writeRawConfig(file: string, data: Record<string, unknown>): Promise<void> {
  await writeFile(file, `${JSON.stringify(data, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
}

/**
 * 从 opencode 配置里捞一份 AI 兜底；格式不对或读不动就当没有，不影响 xdoc 启动。
 */
export function readOpencodeAi(): AiSettings | undefined {
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
