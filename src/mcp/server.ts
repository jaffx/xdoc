import path from 'node:path';
import { createInterface } from 'node:readline';
import { bootstrapSpaces } from '../server/bootstrap';
import {
  appendDoc,
  deleteEntry,
  editDoc,
  expandHome,
  OperationError,
  readDoc,
  renameEntry,
  scaffoldSpaceDir,
  searchDocs,
  writeDoc,
} from '../server/operations';
import { savePersistedSpaces } from '../server/persistence';
import { SpaceManager, type SpaceRuntime } from '../server/space';
import { listDocPaths } from '../server/tree';

const PROTOCOL_VERSION = '2024-11-05';
const SERVER_INFO = { name: 'xdoc', version: '0.1.0' };

type JsonObject = Record<string, unknown>;

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: JsonObject;
  handler: (args: JsonObject) => Promise<unknown>;
}

function ok(id: unknown, result: unknown) {
  return { jsonrpc: '2.0', id, result };
}

function errorResponse(id: unknown, code: number, message: string) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

function toolError(message: string) {
  return { content: [{ type: 'text', text: message }], isError: true };
}

function formatResult(result: unknown): string {
  if (typeof result === 'string') return result;
  return JSON.stringify(result, null, 2);
}

function asString(args: JsonObject, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || !value) throw new OperationError(`缺少参数 ${key}`);
  return value;
}

function asOptionalString(args: JsonObject, key: string): string | undefined {
  const value = args[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function asBoolean(args: JsonObject, key: string, fallback = false): boolean {
  const value = args[key];
  return typeof value === 'boolean' ? value : fallback;
}

function asNumber(args: JsonObject, key: string): number | undefined {
  const value = args[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

const SPACE_PROP = { type: 'string', description: '空间 id 或名称，缺省为第一个空间' };
const PATH_PROP = { type: 'string', description: '空间内的相对路径，如 "guide/intro.md"' };

function buildTools(manager: SpaceManager, persistRegistry: () => void): ToolDefinition[] {
  const resolveSpace = (value: unknown): SpaceRuntime => {
    const spaces = manager.list();
    if (spaces.length === 0) throw new OperationError('尚未加载任何空间');
    if (typeof value !== 'string' || !value.trim()) return manager.default()!;
    const key = value.trim();
    const byId = manager.get(key);
    if (byId) return byId;
    const byName = spaces.find((space) => space.name.toLowerCase() === key.toLowerCase());
    if (byName) return manager.get(byName.id)!;
    throw new OperationError(`空间不存在：${key}。可用空间：${spaces.map((space) => space.name).join('、')}`);
  };

  return [
    {
      name: 'list_spaces',
      description: '列出所有空间：id、名称、备注、根目录、文档数量',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      handler: async () => ({
        spaces: await Promise.all(
          manager.list().map(async (space) => ({
            id: space.id,
            name: space.name,
            description: space.description ?? null,
            root: space.root,
            source: space.source,
            docCount: (await listDocPaths(space.root)).length,
          })),
        ),
      }),
    },
    {
      name: 'create_space',
      description: '新建空间；目录不存在时自动创建并生成 index.md，备注等信息会被持久化',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '空间根目录，支持 ~ 开头' },
          name: { type: 'string', description: '空间名称，默认取目录名' },
          description: { type: 'string', description: '空间备注' },
          create: { type: 'boolean', description: '目录不存在时是否创建目录，默认 true' },
        },
        required: ['path'],
        additionalProperties: false,
      },
      handler: async (args) => {
        const target = path.resolve(expandHome(asString(args, 'path')));
        const name = asOptionalString(args, 'name');
        if (args.create !== false) await scaffoldSpaceDir(target, name);
        const now = Date.now();
        const { space, created } = await manager.add({
          root: target,
          name,
          description: asOptionalString(args, 'description'),
          source: 'user',
          tracked: true,
          createdAt: now,
          updatedAt: now,
        });
        if (created) persistRegistry();
        return { space, created };
      },
    },
    {
      name: 'update_space',
      description: '更新空间名称或备注',
      inputSchema: {
        type: 'object',
        properties: {
          space: SPACE_PROP,
          name: { type: 'string', description: '新名称' },
          description: { type: 'string', description: '新备注，传空字符串可清除' },
        },
        required: ['space'],
        additionalProperties: false,
      },
      handler: async (args) => {
        const runtime = resolveSpace(args.space);
        const space = runtime.updateMetadata({
          name: typeof args.name === 'string' ? args.name : undefined,
          description: typeof args.description === 'string' ? args.description : undefined,
        });
        persistRegistry();
        return { space };
      },
    },
    {
      name: 'list_docs',
      description: '列出空间内所有 markdown 文档（展平路径，按名称排序）',
      inputSchema: { type: 'object', properties: { space: SPACE_PROP }, additionalProperties: false },
      handler: async (args) => {
        const runtime = resolveSpace(args.space);
        return { space: runtime.info.id, docs: await listDocPaths(runtime.info.root) };
      },
    },
    {
      name: 'read_doc',
      description: '读取文档内容（markdown 原文，或 format=html 预览渲染结果）',
      inputSchema: {
        type: 'object',
        properties: {
          space: SPACE_PROP,
          path: PATH_PROP,
          format: { type: 'string', enum: ['markdown', 'html'], description: '默认 markdown' },
        },
        required: ['path'],
        additionalProperties: false,
      },
      handler: async (args) => {
        const runtime = resolveSpace(args.space);
        const { path: rel, content } = await readDoc(runtime.info.root, asString(args, 'path'));
        if (args.format === 'html') {
          return {
            path: rel,
            html: runtime.renderer.render(content, { path: rel, root: runtime.info.root, space: runtime.info.id }),
          };
        }
        return { path: rel, content };
      },
    },
    {
      name: 'write_doc',
      description: '创建或覆盖文档（仅 .md/.markdown），自动补扩展名、自动创建父目录',
      inputSchema: {
        type: 'object',
        properties: { space: SPACE_PROP, path: PATH_PROP, content: { type: 'string', description: 'markdown 内容' } },
        required: ['path', 'content'],
        additionalProperties: false,
      },
      handler: async (args) => {
        const runtime = resolveSpace(args.space);
        const content = asString(args, 'content');
        const rel = await writeDoc(runtime.info.root, asString(args, 'path'), content);
        return { space: runtime.info.id, path: rel, bytes: Buffer.byteLength(content) };
      },
    },
    {
      name: 'append_doc',
      description: '在文档末尾追加内容（不存在则创建）',
      inputSchema: {
        type: 'object',
        properties: { space: SPACE_PROP, path: PATH_PROP, content: { type: 'string' } },
        required: ['path', 'content'],
        additionalProperties: false,
      },
      handler: async (args) => {
        const runtime = resolveSpace(args.space);
        const rel = await appendDoc(runtime.info.root, asString(args, 'path'), asString(args, 'content'));
        return { space: runtime.info.id, path: rel };
      },
    },
    {
      name: 'edit_doc',
      description: '对文档做精确文本替换；命中多处时需 replace_all=true',
      inputSchema: {
        type: 'object',
        properties: {
          space: SPACE_PROP,
          path: PATH_PROP,
          old_text: { type: 'string', description: '要替换的原文（需精确匹配）' },
          new_text: { type: 'string', description: '替换后的文本，默认空字符串（删除）' },
          replace_all: { type: 'boolean', description: '是否替换全部匹配' },
        },
        required: ['path', 'old_text'],
        additionalProperties: false,
      },
      handler: async (args) => {
        const runtime = resolveSpace(args.space);
        const result = await editDoc(
          runtime.info.root,
          asString(args, 'path'),
          asString(args, 'old_text'),
          typeof args.new_text === 'string' ? args.new_text : '',
          asBoolean(args, 'replace_all'),
        );
        return { space: runtime.info.id, ...result };
      },
    },
    {
      name: 'move_doc',
      description: '重命名或移动文件 / 目录到空间内新路径',
      inputSchema: {
        type: 'object',
        properties: {
          space: SPACE_PROP,
          from: { type: 'string', description: '原相对路径' },
          to: { type: 'string', description: '新相对路径' },
        },
        required: ['from', 'to'],
        additionalProperties: false,
      },
      handler: async (args) => {
        const runtime = resolveSpace(args.space);
        const rel = await renameEntry(runtime.info.root, asString(args, 'from'), asString(args, 'to'));
        return { space: runtime.info.id, path: rel };
      },
    },
    {
      name: 'delete_doc',
      description: '删除文档；删除目录需 recursive=true',
      inputSchema: {
        type: 'object',
        properties: {
          space: SPACE_PROP,
          path: PATH_PROP,
          recursive: { type: 'boolean', description: '目录是否递归删除' },
        },
        required: ['path'],
        additionalProperties: false,
      },
      handler: async (args) => {
        const runtime = resolveSpace(args.space);
        const rel = await deleteEntry(runtime.info.root, asString(args, 'path'), asBoolean(args, 'recursive'));
        return { space: runtime.info.id, path: rel, deleted: true };
      },
    },
    {
      name: 'search_docs',
      description: '在空间内全文检索，返回文件、行号与内容片段',
      inputSchema: {
        type: 'object',
        properties: {
          space: SPACE_PROP,
          query: { type: 'string', description: '检索内容' },
          regex: { type: 'boolean', description: '按正则表达式匹配' },
          case_sensitive: { type: 'boolean' },
          limit: { type: 'number', description: '最大返回条数，默认 50' },
        },
        required: ['query'],
        additionalProperties: false,
      },
      handler: async (args) => {
        const runtime = resolveSpace(args.space);
        const matches = await searchDocs(runtime.info.root, asString(args, 'query'), {
          regex: asBoolean(args, 'regex'),
          caseSensitive: asBoolean(args, 'case_sensitive'),
          limit: asNumber(args, 'limit'),
        });
        return { space: runtime.info.id, count: matches.length, matches };
      },
    },
    {
      name: 'list_embeds',
      description: '列出空间已注册的嵌入体语法（可在文档中使用 :::name ... :::）',
      inputSchema: { type: 'object', properties: { space: SPACE_PROP }, additionalProperties: false },
      handler: async (args) => {
        const runtime = resolveSpace(args.space);
        return {
          space: runtime.info.id,
          embeds: runtime.renderer.registry.list().map((definition) => ({
            syntax: `:::${definition.name} ... :::`,
            name: definition.name,
            aliases: definition.aliases ?? [],
            description: definition.description ?? '',
          })),
        };
      },
    },
    {
      name: 'render_markdown',
      description: '把一段 markdown 按空间扩展渲染为 HTML（写入前可先验证自定义语法）',
      inputSchema: {
        type: 'object',
        properties: { space: SPACE_PROP, markdown: { type: 'string' } },
        required: ['markdown'],
        additionalProperties: false,
      },
      handler: async (args) => {
        const runtime = resolveSpace(args.space);
        return { html: runtime.renderer.render(asString(args, 'markdown'), {}) };
      },
    },
  ];
}

export interface McpSessionOptions {
  roots: string[];
  /** 响应输出（默认 stdout） */
  write?: (line: string) => void;
  /** 日志输出（默认 stderr） */
  log?: (message: string) => void;
}

export interface McpSession {
  handleLine: (line: string) => Promise<void>;
  handle: (message: JsonObject) => Promise<unknown | null>;
  close: () => Promise<void>;
}

export async function createMcpSession(options: McpSessionOptions): Promise<McpSession> {
  const write = options.write ?? ((line: string) => process.stdout.write(`${line}\n`));
  const log = options.log ?? ((message: string) => console.error(`[xdoc-mcp] ${message}`));

  const manager = new SpaceManager(() => {}, { watch: false });
  await bootstrapSpaces(manager, options.roots, log);
  const persistRegistry = () => savePersistedSpaces(manager.entries());
  const tools = buildTools(manager, persistRegistry);
  const toolsByName = new Map(tools.map((tool) => [tool.name, tool]));

  const handle = async (message: JsonObject): Promise<unknown | null> => {
    const { id, method, params } = message;
    const isNotification = id === undefined || id === null;
    if (typeof method !== 'string') {
      return isNotification ? null : errorResponse(id, -32600, '缺少 method');
    }
    if (method.startsWith('notifications/') || isNotification) return null;

    const parameters = (params ?? {}) as JsonObject;
    switch (method) {
      case 'initialize':
        return ok(id, {
          protocolVersion:
            typeof parameters.protocolVersion === 'string' ? parameters.protocolVersion : PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
          instructions:
            'xdoc MCP：可读写 markdown 文档与空间。常用工具：list_spaces、list_docs、read_doc、write_doc、edit_doc、search_docs。',
        });
      case 'ping':
        return ok(id, {});
      case 'tools/list':
        return ok(id, {
          tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
        });
      case 'tools/call': {
        const name = typeof parameters.name === 'string' ? parameters.name : '';
        const tool = toolsByName.get(name);
        if (!tool) return ok(id, toolError(`未知工具：${name}`));
        const args = (parameters.arguments ?? {}) as JsonObject;
        try {
          const result = await tool.handler(args);
          return ok(id, { content: [{ type: 'text', text: formatResult(result) }], isError: false });
        } catch (error) {
          return ok(id, toolError(error instanceof Error ? error.message : String(error)));
        }
      }
      case 'resources/list':
        return ok(id, { resources: [] });
      case 'resources/templates/list':
        return ok(id, { resourceTemplates: [] });
      case 'prompts/list':
        return ok(id, { prompts: [] });
      default:
        return errorResponse(id, -32601, `不支持的方法：${method}`);
    }
  };

  // 串行处理请求，保证前一条消息（如 write_doc）完成后再处理下一条
  let queue: Promise<unknown> = Promise.resolve();
  const enqueue = (task: () => Promise<void>): Promise<void> => {
    const run = queue.then(task, task);
    queue = run.catch(() => undefined);
    return run;
  };

  const processLine = async (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let message: unknown;
    try {
      message = JSON.parse(trimmed);
    } catch {
      log(`无法解析输入：${trimmed.slice(0, 120)}`);
      return;
    }
    const response = await handle(message as JsonObject);
    if (response) write(JSON.stringify(response));
  };

  const handleLine = (line: string): Promise<void> => enqueue(() => processLine(line));

  return {
    handleLine,
    handle,
    close: async () => {
      await queue.catch(() => undefined);
      await manager.closeAll();
    },
  };
}

/** stdio 模式：把 stdin 的换行分隔 JSON-RPC 消息接入会话 */
export async function runMcpStdio(options: { roots: string[] }): Promise<void> {
  // MCP 的 stdout 只允许 JSON-RPC，日志一律走 stderr
  console.log = (...args: unknown[]) => console.error(...args);
  console.warn = (...args: unknown[]) => console.error(...args);

  const session = await createMcpSession({ roots: options.roots });
  console.error(`[xdoc-mcp] 已启动，stdio 模式，空间数：${options.roots.length}`);

  const reader = createInterface({ input: process.stdin, crlfDelay: Infinity });
  reader.on('line', (line) => {
    void session.handleLine(line);
  });

  const shutdown = async () => {
    await session.close();
    process.exit(0);
  };
  reader.on('close', () => void shutdown());
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}