import { createAnthropic } from '@ai-sdk/anthropic';
import { generateText, stepCountIs, streamText, tool } from 'ai';
import { z } from 'zod';
import { listDocPaths, readDoc, searchDocs } from '../doc/service';
import type { SrvcSettings } from '../settings/service';
import type { MgrSpaceRuntime } from '../space/service';
import type { ChatMessage } from './types';

/**
 * 对话模块的 Manager：外部世界只有一个——模型 API。
 *
 * 这里是全项目唯一 import @ai-sdk/* 的地方（R5），因此也被延迟加载：
 * 没配 AI 也用得上 xdoc，不该为它付出启动代价。
 */

/** 没在设置里指定模型时用这个 */
const DEFAULT_MODEL = 'claude-sonnet-5';
/** 工具调用最多来回几步，防止模型自己绕圈 */
const MAX_STEPS = 10;

export interface LlmOptions {
  model?: string;
  useTools?: boolean;
  instructions?: string;
  abortSignal?: AbortSignal;
}

/**
 * 工具绑定的是一次对话所在的空间：模型不必（也无法可靠地）自己指定空间，
 * 因为 xdoc 的对话本身就是按空间隔离的。
 */
function createXdocTools(runtime: MgrSpaceRuntime) {
  const docRoot = runtime.info.docRoot;

  return {
    read_doc: tool({
      description: '读取 xdoc 空间内的 markdown 文档内容',
      inputSchema: z.object({
        path: z.string().describe('文档路径（相对路径，如 "guide/intro.md"）'),
      }),
      execute: async ({ path }) => {
        try {
          const result = await readDoc(docRoot, path);
          return { success: true, content: result.content };
        } catch (error) {
          return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
      },
    }),

    list_docs: tool({
      description: '列出空间内的所有文档',
      inputSchema: z.object({}),
      execute: async () => {
        try {
          return { success: true, docs: await listDocPaths(docRoot) };
        } catch (error) {
          return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
      },
    }),

    search_docs: tool({
      description: '在空间内搜索文档内容',
      inputSchema: z.object({
        query: z.string().describe('搜索关键词'),
        limit: z.number().optional().default(10).describe('最大返回条数'),
      }),
      execute: async ({ query, limit }) => {
        try {
          return { success: true, results: await searchDocs(docRoot, query, { limit }) };
        } catch (error) {
          return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
      },
    }),
  };
}

/**
 * 模型入口。每次调用都重新读一遍配置，不缓存：设置面板改完 apiKey 立刻生效，不用重启。
 * 配置怎么来的（xdoc 的 config.json，还是兜底读 opencode）见 ../settings/service。
 */
export class MgrLlmClient {
  #store: SrvcSettings;

  constructor(store: SrvcSettings) {
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

  #tools(runtime: MgrSpaceRuntime, useTools?: boolean) {
    return useTools ? createXdocTools(runtime) : undefined;
  }

  async chat(messages: ChatMessage[], runtime: MgrSpaceRuntime, options: LlmOptions = {}): Promise<string> {
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
  async stream(messages: ChatMessage[], runtime: MgrSpaceRuntime, options: LlmOptions = {}) {
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
