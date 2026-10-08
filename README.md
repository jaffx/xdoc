# xdoc

支持**自定义嵌入体语法**的 Markdown 文档浏览工具。

- 完整支持 markdown 原生语法，并渲染为 HTML
- 通过 `:::名称 参数 ... :::` 定义块级扩展语法（嵌入体）
- 扩展机制 = **语法 + 渲染逻辑**，`registerEmbed` 注册，配置热加载
- 本地浏览体验：目录树、搜索、TOC、实时刷新、代码高亮、亮暗主题、图片/链接站内跳转

## 快速开始

```bash
npm install
npm run build

# 浏览 examples 目录（自动打开浏览器）
node dist/cli.js examples

# 多个目录 = 多个空间，网页左上角切换
node dist/cli.js examples notes

# 或浏览当前目录、指定端口
node dist/cli.js . --port 4000
```

开发模式（tsx 直跑源码）：

```bash
npm run dev
```

## 空间（Spaces）

每个空间 = 一个独立的文档根目录，彼此隔离：

- 独立的目录树与文档
- 独立的 `xdoc.config.ts`：自定义嵌入体、CSS 互不影响，均支持热加载
- 独立的文件监听，扩展改动只影响当前空间

空间来源：

1. **CLI 参数**：`xdoc dir1 dir2`，每次启动生效
2. **UI 添加**：空间菜单输入已有目录路径
3. **UI 新建**：空间菜单点「新建空间」按钮，输入位置/名称/备注，目录不存在会自动创建并生成 `index.md`
4. **UI 移除**：悬停空间项点击垃圾桶图标（服务端保证至少保留一个空间）

空间支持**元数据**：名称与备注可在 UI 中编辑（悬停空间项点铅笔图标），连同创建/更新时间一起持久化到 `~/.xdoc/spaces.json`，下次启动自动恢复，路径支持 `~` 开头。

URL 结构为 `#/空间id/文档路径`，切换空间时会记住每个空间上次阅读的文档。

## 文档管理

空间内的文档按目录树组织（虚拟路径 = 物理路径映射）：

- 侧边栏工具栏可按根目录**新建文件 / 新建文件夹**
- 悬停目录行可**在该目录内新建**，悬停任意行可**重命名 / 删除**（目录删除需确认，级联删除）
- 文件名不带 `.md` 时自动补全；新建后自动打开
- 文件夹与文件**统一按名称排序**（自然排序，如 `2` 在 `10` 前）
- 以 `.` 开头的文件和目录不会显示，也不能通过接口创建

## 内置嵌入体

### html —— 原始 HTML

```markdown
:::html
<iframe src="https://example.com"></iframe>
:::
```

### highlight —— 高亮块

支持 `note`、`info`、`tip`、`success`、`warning`、`danger`，变体名可直接作为别名使用：

```markdown
:::warning 注意标题
支持 **markdown** 内容，也支持 :::highlight type=danger title="..." 显式写法。
:::
```

### todo —— 交互式任务清单

```markdown
:::todo title="发布清单"
- [x] 初始化项目
- [ ] 编写文档
:::
```

自动统计完成进度，页面内可勾选。

### table —— 表格容器

```markdown
:::table title="参数说明" zebra bordered compact
| 字段 | 类型 |
| --- | --- |
| id | string |
:::
```

样式开关：`zebra`（斑马纹）、`bordered`（完整边框）、`compact`（紧凑）。

### 嵌套

外层使用更长的冒号标记即可嵌套：

```markdown
::::card title="外层"
:::warning 内层
用三个冒号
:::
::::
```

## 自定义扩展

在文档根目录创建 `xdoc.config.ts`（支持 `.mts` / `.js` / `.mjs`），保存后自动热加载。**每个空间有独立的配置文件**。

```ts
import type { EmbedDefinition } from 'xdoc';

export default function setup(api: {
  registerEmbed: (definition: EmbedDefinition) => void;
  addStyles: (css: string) => void;
}) {
  api.addStyles(`.badge { color: #4f7cff; }`);

  api.registerEmbed({
    name: 'badge',
    aliases: ['tag'],
    description: '彩色标签',
    render: (ctx) => {
      const color = ctx.attrs.color ?? 'blue';
      return `<span class="badge" data-color="${ctx.escapeHtml(color)}">${ctx.escapeHtml(ctx.content.trim())}</span>`;
    },
  });
}
```

文档中使用：

```markdown
:::badge color=green
已上线
:::
```

### 渲染上下文（ctx）

| 字段 | 说明 |
| --- | --- |
| `name` | 命中的名称（别名保留原样） |
| `params` | `:::name` 之后的原始参数串 |
| `attrs` | `key=value` 解析结果（值支持引号） |
| `positional` | 非 `key=value` 的位置参数 |
| `content` | 块内原始 markdown 文本 |
| `env` | 渲染环境，可在嵌入体之间传递数据 |
| `render(md)` | 渲染 markdown 为 HTML（递归解析嵌入体） |
| `renderInline(md)` | 只渲染行内 markdown，不产生 `<p>` |
| `escapeHtml(s)` | HTML 转义 |

## MCP（给 Agent 调用）

内置零依赖 MCP stdio 服务，Agent 可以直接读写改空间内的文档：

```bash
# 直接运行
node dist/cli.js mcp ./docs ./notes

# 或通过 npx 配置到 Agent
npx xdoc mcp ./docs
```

Claude Code / Claude Desktop 配置示例：

```json
{
  "mcpServers": {
    "xdoc": {
      "command": "node",
      "args": ["/absolute/path/to/xdoc/dist/cli.js", "mcp", "/absolute/path/to/docs"]
    }
  }
}
```

### 工具列表

| 工具 | 说明 |
| --- | --- |
| `list_spaces` | 空间列表（含备注、文档数） |
| `create_space` | 新建空间（自动建目录、生成 index.md、持久化备注） |
| `update_space` | 更新空间名称 / 备注 |
| `list_docs` | 列出空间内全部 markdown 路径 |
| `read_doc` | 读取文档（markdown 原文或 html 预览） |
| `write_doc` | 创建 / 覆盖文档（自动补 `.md`、自动建父目录） |
| `append_doc` | 追加内容到文档末尾 |
| `edit_doc` | 精确文本替换（命中多处需 `replace_all`） |
| `move_doc` | 重命名 / 移动文件或目录 |
| `delete_doc` | 删除文件；目录需 `recursive: true` |
| `search_docs` | 空间内全文检索，返回路径 + 行号 + 片段 |
| `list_embeds` | 列出已注册嵌入体语法（写文档时可直接用） |
| `render_markdown` | 把 markdown 按空间扩展渲染为 HTML（验证自定义语法） |

工具都支持 `space` 参数（id 或名称，缺省第一个空间），路径为空间内相对路径，与网页端共享 `~/.xdoc/spaces.json`。

## 编程式使用

核心渲染层不与服务端耦合，可作为库使用：

```ts
import { createRenderer } from 'xdoc';

const renderer = createRenderer();
renderer.registry.register({
  name: 'badge',
  render: (ctx) => `<b>${ctx.escapeHtml(ctx.content)}</b>`,
});

const html = renderer.render(':::badge\n你好\n:::');
```

## CLI

```
xdoc [目录...] [选项]        启动本地文档站点
xdoc mcp [目录...]          启动 MCP stdio 服务

每个目录成为一个空间；不传目录时使用当前目录。

  -p, --port <端口>   监听端口（默认 3000，被占用时自动 +1 重试）
      --host <地址>   监听地址（默认 127.0.0.1）
      --no-open       不自动打开浏览器
  -h, --help          显示帮助
  -v, --version       显示版本
```

## 项目结构

```
src/
├── core/               # 渲染核心（无服务端依赖，可独立复用）
│   ├── renderer.ts     # markdown-it 集成 + ::: 块级解析 + 嵌入体渲染
│   ├── registry.ts     # 嵌入体注册表
│   ├── attrs.ts        # key=value 参数解析
│   └── embeds/         # 内置嵌入体 html / highlight / todo / table
├── server/
│   ├── index.ts        # HTTP 服务与路由
│   ├── space.ts        # SpaceManager：多空间运行时（渲染器/监听/配置热加载）
│   ├── operations.ts   # 文档操作：新建/写入/替换/移动/删除/检索（HTTP 与 MCP 共用）
│   ├── bootstrap.ts    # 空间初始化（CLI 目录 + 持久化注册表）
│   ├── persistence.ts  # 空间注册表与元数据（~/.xdoc/spaces.json）
│   ├── tree.ts         # markdown 目录树扫描（统一按名排序，隐藏 . 开头）
│   └── config.ts       # xdoc.config.ts 加载与编译
├── mcp/
│   └── server.ts       # 零依赖 MCP stdio 服务（JSON-RPC）
├── client/             # 浏览器端：空间切换、路由、目录树管理、TOC、交互增强
└── cli.ts
```

服务接口（除 `/api/spaces` 外均可用 `?space=<id>` 指定空间，缺省第一个空间）：

| 接口 | 说明 |
| --- | --- |
| `GET /api/spaces` | 空间列表 |
| `POST /api/spaces` | 新增/新建空间 `{ path, name?, description?, create? }` |
| `PATCH /api/spaces` | 更新名称/备注 `{ id, name?, description? }` |
| `DELETE /api/spaces?id=` | 移除空间 |
| `POST /api/mkdir` | 新建目录 `{ space?, path }` |
| `POST /api/file` | 新建文档 `{ space?, path, content? }` |
| `POST /api/rename` | 重命名/移动 `{ space?, from, to }` |
| `DELETE /api/entry` | 删除文件/目录 `?space=&path=&recursive=` |
| `GET /api/tree` | markdown 目录树 |
| `GET /api/doc?path=` | 渲染文档为 HTML |
| `GET /api/raw?path=` | 原始 markdown |
| `GET /api/asset?path=` | 空间目录内的静态资源 |
| `GET /api/embeds` | 已注册嵌入体列表 |
| `GET /api/styles` | 自定义 CSS |
| `GET /api/events` | SSE：change / tree / config / spaces |

## 开发

```bash
npm run typecheck   # 类型检查
npm test            # 单元测试（node:test）
npm run build       # 构建 dist/cli.js 与前端资源
npm run dev         # 构建后以 tsx 运行 examples
```