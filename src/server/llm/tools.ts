import { tool } from 'ai'
import { z } from 'zod'
import { readDoc, searchDocs } from '../operations'
import { listDocPaths } from '../tree'
import type { SpaceRuntime } from '../space'

export function createXdocTools(getRuntime: () => SpaceRuntime) {
  const readDocTool = tool({
    description: '读取 xdoc 空间内的 markdown 文档内容',
    inputSchema: z.object({
      space: z.string().describe('空间 ID 或名称'),
      path: z.string().describe('文档路径（相对路径，如 "guide/intro.md"）'),
    }),
    execute: async ({ space, path }) => {
      try {
        const runtime = getRuntime()
        const result = await readDoc(runtime.info.docRoot, path)
        return { success: true, content: result.content }
      } catch (error: any) {
        return { success: false, error: error.message }
      }
    },
  })

  const listDocsTool = tool({
    description: '列出空间内的所有文档',
    inputSchema: z.object({
      space: z.string().describe('空间 ID 或名称'),
    }),
    execute: async ({ space }) => {
      try {
        const runtime = getRuntime()
        const docs = await listDocPaths(runtime.info.docRoot)
        return { success: true, docs }
      } catch (error: any) {
        return { success: false, error: error.message }
      }
    },
  })

  const searchDocsTool = tool({
    description: '在空间内搜索文档内容',
    inputSchema: z.object({
      space: z.string().describe('空间 ID 或名称'),
      query: z.string().describe('搜索关键词'),
      limit: z.number().optional().default(10).describe('最大返回条数'),
    }),
    execute: async ({ space, query, limit }) => {
      try {
        const runtime = getRuntime()
        const results = await searchDocs(runtime.info.docRoot, query, { limit })
        return { success: true, results }
      } catch (error: any) {
        return { success: false, error: error.message }
      }
    },
  })

  return {
    read_doc: readDocTool,
    list_docs: listDocsTool,
    search_docs: searchDocsTool,
  }
}
