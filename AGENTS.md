# xdoc 项目 Agent 指南

## 📚 知识管理（自用自吃）

本项目用自身的 MCP 服务沉淀开发知识——xdoc 的开发文档存在 xdoc 里。

- **空间**：`xdoc`
- **开工前**：要动功能设计、架构，或可能踩过坑的地方，先 `search_docs` 看一眼有没有相关文档
- **收工后**：新增核心功能、定了技术取舍、解了疑难、重构了结构，写回空间

### 文档结构

```
xdoc 空间/
├── 项目总览/     # 架构、技术栈
├── 功能模块/     # 已实现功能的文档
├── 施工记录/     # 开发中的模块
└── 版本记录/     # 按年月
```

文档一律带编号前缀（`001-xxx.md`），新建前先看同目录已有的编号接着排。`施工记录/` 下一个模块一个目录，放 README（概述与待办）、技术文档、讨论记录、开发日志；模块做完后设计沉淀进 `功能模块/`。

### 写作规范

用 xdoc 的嵌入体语法组织内容：

| 语法 | 用途 |
| --- | --- |
| `:::note` / `:::info` / `:::tip` / `:::success` / `:::warning` / `:::danger` | 各类提示框；关键结论、前置条件、风险别埋在段落里 |
| `:::table title="…"` | 结构化数据（参数说明、方案对比） |
| `:::mermaid` | 流程、架构、时序 |
| `:::echarts` | 统计、占比 |
| `:::html` | 需要手写 HTML 时 |

首行写 `# 一级标题`，正文用 `##` / `###` 分节；代码块标注语言；文档间链接用相对路径；写完用 `render_markdown` 验一遍语法。

### 项目文档

编码规范和测试指南放在仓库的 `docs/` 目录（不在 xdoc 空间）：

- `docs/代码风格.md` —— TypeScript 规范、命名约定、分层与层前缀
- `docs/测试指南.md` —— node:test 使用指南

## 🛠 项目技术栈

- **运行时**: Node.js ≥18.17 + TypeScript
- **构建**: esbuild
- **前端**: 原生 JS（无框架），markdown-it 渲染
- **图表**: mermaid（流程图）、echarts（数据图）
- **代码高亮**: highlight.js
- **文件监听**: chokidar
- **测试**: node:test

## 📁 代码结构

```
src/
├── core/         # 渲染内核：markdown → HTML，不碰 HTTP / 文件 / DOM
├── server/       # HTTP 入口：按模块分目录，模块内按层分文件
│   ├── index.ts · context.ts · bootstrap.ts   组装点
│   ├── kernel/   共享地基：路径、错误词汇、HTTP 工具、事件
│   └── <模块>/   ctrl · service · manager · dao（+ 可选 types）
├── mcp/          # MCP stdio/HTTP，与 HTTP 平级的另一个入口
├── client/       # 浏览器端（无框架；不引用 core，正文 HTML 由服务端渲染）
└── cli.ts        # 命令行入口
```

## 🧱 分层架构

服务端按「模块 → 层」组织。四层是一条链，只能往下依赖：

```
入口 Controller → 业务 Service → Manager → 存储 Dao
                 kernel/ 为四层共享的地基
```

**按「什么变了」分层**：

| 变的是 | 就落在 |
| --- | --- |
| 协议（HTTP / MCP / CLI） | 入口 Controller |
| 业务规则 | 业务 Service |
| 外部世界（文件系统、模型 API、用户配置） | Manager |
| 存储形态 | 存储 Dao |

**几条硬规矩**：

- 跨模块只走对方的 `service`，不许伸手进别人的 `dao`
- 事务只划在业务层
- 层前缀只加在**类名**上：`Ctrl*` / `Srvc*` / `Dao*` / `Mgr*`；实体、值对象、类型不加
- 「文件 → 层」那张落地声明在 `docs/代码风格.md`，新增模块照它写

### 错误处理

- 存储层与业务层**只说事实**：抛 `src/server/kernel/errors.ts` 里的领域错误（`NotFoundError` / `ConflictError` / `PathEscapeError` / …），里面没有状态码
- **入口层只做映射**：`kernel/http.ts` 的 `statusOf(error)` 是全项目唯一的「错误 → 协议码」表
- 两条不得违反：`dao` / `service` / `manager` 不 import `kernel/http`；入口层的 catch 里不写业务 `if`
- **同一操作内的校验次序属于对外契约**，重构不许调换——先判路径越界、再判文件格式，反了 403 就变成 400

## ✅ 工作约定

1. 代码遵循现有风格：TypeScript strict、ESM、async/await；新增模块照 `docs/代码风格.md` 的分层表
2. 提交前跑 `npm run typecheck` 和 `npm test`
3. 开工前、收工后照上面的「知识管理」读写 xdoc

## 🔧 常用命令

```bash
# 开发
npm run dev          # tsx 直跑源码，改完不用构建

# 构建和检查
npm run build        # 构建 dist/
npm run typecheck    # 类型检查
npm test             # 单元测试

# MCP 相关
xdoc list_docs space="xdoc"
xdoc read_doc space="xdoc" path="功能模块/核心渲染层.md"
xdoc write_doc space="xdoc" path="施工记录/xxx.md" content="..."
xdoc search_docs space="xdoc" query="关键词"
```

## 🎯 素材管理

空间目录下 `doc/` 放文档、`assets/` 放素材。上传时服务端按 MIME 归到 `images/`、`videos/`、`audio/`、`other/`，没指定路径的按「日期-原名」命名，如 `images/2026-10-12-shot.png`。

- MCP 工具：`list_assets` / `upload_asset` / `delete_asset` / `rename_asset`
- 素材路径一律相对 `assets/`，如 `images/2026-10-12-shot.png`

---

*本文档由 xdoc 项目开发团队维护，随项目演进持续更新。*
