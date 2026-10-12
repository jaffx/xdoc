import { createAnthropic } from '@ai-sdk/anthropic'
import { generateText, stepCountIs, streamText } from 'ai'
import { readFile } from 'fs/promises'
import { existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { createXdocTools } from './tools'
import type { SpaceRuntime } from '../space'

interface OpencodeProvider {
  npm: string
  name: string
  options: {
    baseURL: string
    apiKey: string
  }
  models: Record<string, any>
}

interface OpencodeConfig {
  provider: Record<string, OpencodeProvider>
}

let cachedProvider: any = null
let cachedModel: string = 'auto'

export async function loadOpencodeConfig(): Promise<{ provider: any; model: string }> {
  if (cachedProvider) {
    return { provider: cachedProvider, model: cachedModel }
  }

  const configPath = join(homedir(), '.config/opencode/opencode.json')
  if (!existsSync(configPath)) {
    throw new Error('opencode 配置文件不存在: ' + configPath)
  }

  const config: OpencodeConfig = JSON.parse(await readFile(configPath, 'utf-8'))
  
  const [, providerConfig] = Object.entries(config.provider)[0]
  
  if (providerConfig.npm !== '@ai-sdk/anthropic') {
    throw new Error(`暂不支持的 provider: ${providerConfig.npm}`)
  }

  cachedProvider = createAnthropic({
    baseURL: providerConfig.options.baseURL,
    apiKey: providerConfig.options.apiKey,
  })

  const models = Object.keys(providerConfig.models)
  // 优先选择具体的模型，避免 'auto'
  cachedModel = models.find(m => m !== 'auto') || models[0]

  return { provider: cachedProvider, model: cachedModel }
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export async function chat(
  messages: ChatMessage[],
  runtime: SpaceRuntime,
  options?: { model?: string; useTools?: boolean; instructions?: string }
): Promise<string> {
  const { provider, model } = await loadOpencodeConfig()
  const modelName = options?.model || model

  const tools = options?.useTools ? createXdocTools(() => runtime) : undefined

  const result = await generateText({
    model: provider(modelName),
    messages,
    instructions: options?.instructions,
    tools,
    stopWhen: tools ? stepCountIs(10) : undefined,
  })

  return result.text
}

/** 流式对话：返回 streamText 结果，调用方消费 fullStream 并转发事件 */
export async function chatStream(
  messages: ChatMessage[],
  runtime: SpaceRuntime,
  options: { model?: string; useTools?: boolean; instructions?: string; abortSignal?: AbortSignal } = {}
) {
  const { provider, model } = await loadOpencodeConfig()
  const modelName = options.model || model

  const tools = options.useTools ? createXdocTools(() => runtime) : undefined

  return streamText({
    model: provider(modelName),
    messages,
    instructions: options.instructions,
    tools,
    stopWhen: tools ? stepCountIs(10) : undefined,
    abortSignal: options.abortSignal,
  })
}
