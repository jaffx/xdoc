import { createAnthropic } from '@ai-sdk/anthropic'
import { generateText } from 'ai'
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
  options?: { model?: string; useTools?: boolean }
): Promise<string> {
  const { provider, model } = await loadOpencodeConfig()
  const modelName = options?.model || model

  const tools = options?.useTools ? createXdocTools(() => runtime) : undefined

  const result = await generateText({
    model: provider(modelName),
    messages,
    tools,
  })
  
  console.log('[xdoc-llm] steps:', result.steps?.length)
  console.log('[xdoc-llm] toolCalls:', result.toolCalls?.length)
  console.log('[xdoc-llm] toolResults:', result.toolResults?.length)
  console.log('[xdoc-llm] finishReason:', result.finishReason)
  console.log('[xdoc-llm] text:', result.text?.slice(0, 100))

  return result.text
}
