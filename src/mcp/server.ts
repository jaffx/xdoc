import path from 'node:path';
import { createInterface } from 'node:readline';
import { bootstrapSpaces } from '../server/bootstrap';
import {
  appendDoc,
  deleteEntry,
  editDoc,
  OperationError,
  readDoc,
  renameEntry,
  searchDocs,
  writeDoc,
} from '../server/operations';
import { loadIndex, saveIndex } from '../server/persistence';
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

/**
 * 写文档的排版指南。
 *
 * MCP 客户端通常只读 initialize 的 instructions 与工具 description，
 * 因此这里既作为 instructions 的主体，也通过 style_guide 工具单独提供。
 */
const STYLE_GUIDE = `# xdoc 文档排版指南

xdoc 支持 \`:::名称 参数 ... :::\` 的块级嵌入体语法。写文档时优先用嵌入体表达结构，
不要把所有内容堆成纯段落——排版好的文档在 xdoc 网页端可读性高得多。

## 内置嵌入体

### 提示块 highlight
别名直接当名字用：\`note\`（说明）、\`info\`（信息）、\`tip\`（提示）、\`success\`（完成）、
\`warning\`（注意）、\`danger\`（危险）。第一个位置参数是标题，内部支持完整 markdown。

\`\`\`
:::tip 性能建议
开启缓存后首屏可以快 **40%** 左右。
:::

:::danger 不可逆操作
执行前请先备份数据库。
:::
\`\`\`

### 表格 table
\`:::table title="..." zebra bordered compact\`。内容可以写 markdown 表格，
也可以直接写原始 HTML —— 需要合并单元格时用 HTML 的 \`colspan\` / \`rowspan\`：

\`\`\`
:::table title="分区域销量" bordered
<table>
  <thead>
    <tr><th rowspan="2">区域</th><th colspan="2">上半年</th></tr>
    <tr><th>销量</th><th>同比</th></tr>
  </thead>
  <tbody>
    <tr><td>华东</td><td>1,280</td><td>+12%</td></tr>
  </tbody>
</table>
:::
\`\`\`

只写 \`<tr>\` 片段也可以，会自动补一层 \`<table>\`。

### mermaid 图
\`:::mermaid title="..."\`（别名 \`diagram\`），块内写 mermaid 源码。
流程、时序、状态、甘特、类图都支持，图表跟随亮暗主题重绘。
讲流程、架构、状态流转时用图代替长段文字描述。

\`\`\`
:::mermaid title="请求链路"
flowchart LR
  A[客户端] --> B{缓存命中?}
  B -- 是 --> C[返回缓存]
  B -- 否 --> D[查库] --> E[写缓存] --> C
:::
\`\`\`

### echarts 图表
\`:::echarts title="..." height=320\`（别名 \`chart\`），块内写 ECharts option，
支持 JSON 与 JS 对象字面量。有数值趋势、占比、对比时用图表而不是罗列数字。

\`\`\`
:::echarts title="每周新增" height=300
{
  tooltip: { trigger: 'axis' },
  xAxis: { type: 'category', data: ['第1周', '第2周', '第3周'] },
  yAxis: { type: 'value' },
  series: [{ type: 'bar', data: [12, 19, 24] }]
}
:::
\`\`\`

### 原始 HTML html
\`:::html\` 内容原样输出、不做 markdown 解析，适合 iframe、视频、自定义卡片。

### 嵌套
外层用更长的冒号标记即可嵌套：外层 \`::::\`，内层 \`:::\`。

## 写作约定

1. 文档首行是 \`# 一级标题\`，正文用 \`##\` / \`###\` 分节（网页端 TOC 取 h2/h3）
2. 关键结论、前置条件、风险提示放进 \`:::tip\` / \`:::warning\` / \`:::danger\`，不要埋在段落里
3. 结构化数据一律进 \`:::table\`，带上 \`title\`
4. 流程与架构画 \`:::mermaid\`；趋势与占比画 \`:::echarts\`
5. 代码块标注语言以启用高亮
6. 文档间用相对路径链接（\`[指南](./guide/intro.md)\`），图片放文档同级目录并用相对路径引用
7. 写完可用 render_markdown 验证嵌入体语法是否正确

注意：当前空间可能通过 xdoc.config.ts 注册了额外的嵌入体，写之前先调 list_embeds 看实际可用列表。`;

function buildTools(manager: SpaceManager, persistIndex: () => void): ToolDefinition[] {
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
      description: '列出所有空间：id、名称、备注、目录名、空间目录、文档根目录、文档数量',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      handler: async () => ({
        spaces: await Promise.all(
          manager.list().map(async (space) => ({
            id: space.id,
            name: space.name,
            description: space.description ?? null,
            slug: space.slug,
            dir: space.dir,
            docRoot: space.docRoot,
            docCount: (await listDocPaths(space.docRoot)).length,
          })),
        ),
      }),
    },
    {
      name: 'create_space',
      description: '按名称新建空间，目录自动建在数据根目录的 spaces/ 下，并生成 meta.json 与 doc/index.md',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '空间名称，目录名由名称派生' },
          description: { type: 'string', description: '空间备注' },
        },
        required: ['name'],
        additionalProperties: false,
      },
      handler: async (args) => {
        const { space, created } = await manager.create({
          name: asString(args, 'name'),
          description: asOptionalString(args, 'description'),
        });
        if (created) persistIndex();
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
        const space = await runtime.updateMetadata({
          name: typeof args.name === 'string' ? args.name : undefined,
          description: typeof args.description === 'string' ? args.description : undefined,
        });
        return { space };
      },
    },
    {
      name: 'list_docs',
      description: '列出空间内所有 markdown 文档（展平路径，按名称排序）',
      inputSchema: { type: 'object', properties: { space: SPACE_PROP }, additionalProperties: false },
      handler: async (args) => {
        const runtime = resolveSpace(args.space);
        return { space: runtime.info.id, docs: await listDocPaths(runtime.info.docRoot) };
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
        const { path: rel, content } = await readDoc(runtime.info.docRoot, asString(args, 'path'));
        if (args.format === 'html') {
          return {
            path: rel,
            html: runtime.renderer.render(content, { path: rel, root: runtime.info.docRoot, space: runtime.info.id }),
          };
        }
        return { path: rel, content };
      },
    },
    {
      name: 'write_doc',
      description:
        '创建或覆盖文档（仅 .md/.markdown），自动补扩展名、自动创建父目录。内容请用 xdoc 嵌入体排版（提示块 :::tip、表格 :::table、流程图 :::mermaid、图表 :::echarts），写前可先读 style_guide',
      inputSchema: {
        type: 'object',
        properties: { space: SPACE_PROP, path: PATH_PROP, content: { type: 'string', description: 'markdown 内容' } },
        required: ['path', 'content'],
        additionalProperties: false,
      },
      handler: async (args) => {
        const runtime = resolveSpace(args.space);
        const content = asString(args, 'content');
        const rel = await writeDoc(runtime.info.docRoot, asString(args, 'path'), content);
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
        const rel = await appendDoc(runtime.info.docRoot, asString(args, 'path'), asString(args, 'content'));
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
          runtime.info.docRoot,
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
        const rel = await renameEntry(runtime.info.docRoot, asString(args, 'from'), asString(args, 'to'));
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
        const rel = await deleteEntry(runtime.info.docRoot, asString(args, 'path'), asBoolean(args, 'recursive'));
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
        const matches = await searchDocs(runtime.info.docRoot, asString(args, 'query'), {
          regex: asBoolean(args, 'regex'),
          caseSensitive: asBoolean(args, 'case_sensitive'),
          limit: asNumber(args, 'limit'),
        });
        return { space: runtime.info.id, count: matches.length, matches };
      },
    },
    {
      name: 'list_embeds',
      description:
        '列出空间已注册的嵌入体语法与示例（内置 html / highlight / table / mermaid / echarts，外加该空间自定义的）。写文档前先调一次，照示例排版',
      inputSchema: { type: 'object', properties: { space: SPACE_PROP }, additionalProperties: false },
      handler: async (args) => {
        const runtime = resolveSpace(args.space);
        return {
          space: runtime.info.id,
          hint: '用这些嵌入体组织内容，不要把所有内容堆成纯段落。完整排版约定见 style_guide 工具。',
          embeds: runtime.renderer.registry.list().map((definition) => ({
            syntax: `:::${definition.name} ... :::`,
            name: definition.name,
            aliases: definition.aliases ?? [],
            description: definition.description ?? '',
            example: definition.example ?? null,
          })),
        };
      },
    },
    {
      name: 'style_guide',
      description:
        'xdoc 文档排版指南：内置嵌入体（提示块、表格、mermaid、echarts）的语法、示例与写作约定。写或改文档前先读，让产出的文档排版规范、可读性好',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      handler: async () => STYLE_GUIDE,
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
  /** 数据根目录，空间位于 <root>/spaces 下 */
  root: string;
  /** 响应输出（默认 stdout） */
  write?: (line: string) => void;
  /** 日志输出（默认 stderr） */
  log?: (message: string) => void;
  /**
   * 复用已有的空间运行时（HTTP 模式传入服务端的 manager）。
   * 不传则自建一个只读文件系统、不监听变更的 manager。
   * 同一个进程里连同一份根目录开两个 manager 会让两边看到的空间列表分叉，
   * 所以能在服务端里挂的场合一律复用。
   */
  manager?: SpaceManager;
  /** 配合 manager 一起复用：写入空间索引的函数 */
  persistIndex?: () => void;
}

export interface McpSession {
  handleLine: (line: string) => Promise<void>;
  handle: (message: JsonObject) => Promise<unknown | null>;
  close: () => Promise<void>;
}

export async function createMcpSession(options: McpSessionOptions): Promise<McpSession> {
  const write = options.write ?? ((line: string) => process.stdout.write(`${line}\n`));
  const log = options.log ?? ((message: string) => console.error(`[xdoc-mcp] ${message}`));

  const root = path.resolve(options.root);
  const ownManager = !options.manager;
  const manager = options.manager ?? new SpaceManager(root, () => {}, { watch: false });
  if (ownManager) await bootstrapSpaces(manager, root, log);
  const persistIndex =
    options.persistIndex ?? (() => saveIndex(root, { ...loadIndex(root), order: manager.order() }));
  const tools = buildTools(manager, persistIndex);
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
          instructions: `xdoc MCP：可读写 markdown 文档与空间。
常用工具：list_spaces、list_docs、read_doc、write_doc、edit_doc、search_docs、list_embeds、style_guide、render_markdown。

写或改文档时请使用 xdoc 的嵌入体语法排版，不要只写纯段落。下面是完整排版指南（也可随时调 style_guide 工具取回）：

${STYLE_GUIDE}`,
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
      // 复用的 manager 归服务端所有，由服务端关闭
      if (ownManager) await manager.closeAll();
    },
  };
}

/** stdio 模式：把 stdin 的换行分隔 JSON-RPC 消息接入会话 */
export async function runMcpStdio(options: { root: string }): Promise<void> {
  // MCP 的 stdout 只允许 JSON-RPC，日志一律走 stderr
  console.log = (...args: unknown[]) => console.error(...args);
  console.warn = (...args: unknown[]) => console.error(...args);

  const session = await createMcpSession({ root: options.root });
  console.error(`[xdoc-mcp] 已启动，stdio 模式，数据根目录：${options.root}`);

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