import { createAnthropic } from '@ai-sdk/anthropic';
import { generateText, stepCountIs, streamText } from 'ai';
import type { SettingsStore } from '../settings';
import type { SpaceRuntime } from '../space';
import { createXdocTools } from './tools';

/** 没在设置里指定模型时用这个 */
const DEFAULT_MODEL = 'claude-sonnet-5';
/** 工具调用最多来回几步，防止模型自己绕圈 */
const MAX_STEPS = 10;

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface LlmOptions {
  model?: string;
  useTools?: boolean;
  instructions?: string;
  abortSignal?: AbortSignal;
}

/**
 * AI 助手的模型入口。
 *
 * 每次调用都重新读一遍配置，不缓存：设置面板改完 apiKey 立刻生效，不用重启。
 * 配置怎么来的（xdoc 的 config.json，还是兜底读 opencode）见 server/settings.ts。
 */
export class LlmClient {
  #store: SettingsStore;

  constructor(store: SettingsStore) {
    this.#store = store;
  }

  /** 按当前配置建出要用的模型；没配 key 时在这里报错，错误信息直接给面板指路 */
  #model(override?: string) {
    const { settings } = this.#store.resolveAi();
    if (!settings.apiKey) {
      throw new Error('还没配置 API Key：点右上角的设置按钮，在「AI 助手」里填一个');
    }
    const provider = createAnthropic({
      apiKey: settings.apiKey,
      ...(settings.baseURL ? { baseURL: settings.baseURL } : {}),
    });
    return provider(override || settings.model || DEFAULT_MODEL);
  }

  #tools(runtime: SpaceRuntime, useTools?: boolean) {
    return useTools ? createXdocTools(() => runtime) : undefined;
  }

  async chat(messages: ChatMessage[], runtime: SpaceRuntime, options: LlmOptions = {}): Promise<string> {
    const tools = this.#tools(runtime, options.useTools);
    const result = await generateText({
      model: this.#model(options.model),
      messages,
      instructions: options.instructions,
      tools,
      stopWhen: tools ? stepCountIs(MAX_STEPS) : undefined,
    });
    return result.text;
  }

  /** 流式对话：返回 streamText 结果，调用方消费 fullStream 并转发事件 */
  async stream(messages: ChatMessage[], runtime: SpaceRuntime, options: LlmOptions = {}) {
    const tools = this.#tools(runtime, options.useTools);
    return streamText({
      model: this.#model(options.model),
      messages,
      instructions: options.instructions,
      tools,
      stopWhen: tools ? stepCountIs(MAX_STEPS) : undefined,
      abortSignal: options.abortSignal,
    });
  }
}
