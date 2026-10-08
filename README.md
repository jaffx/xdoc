# xdoc

支持**自定义嵌入体语法**的 Markdown 文档浏览工具。

- 完整支持 markdown 原生语法，并渲染为 HTML
- 通过 `:::名称 参数 ... :::` 定义块级扩展语法（嵌入体）
- 扩展机制 = **语法 + 渲染逻辑**，`registerEmbed` 注册，配置热加载
- 本地浏览体验：目录树、搜索、TOC、实时刷新、代码高亮、亮暗主题、图片/链接站内跳转
- 两侧面板都能收起：窄屏侧栏是遮罩抽屉，宽屏则由标题栏左侧按钮整条推出视口；右侧「本文目录」可折叠，收起状态记在 localStorage
- 可部署到服务器：令牌保护、可选 HTTPS，浏览器与本地 Agent 都能远程读写，见[远程部署](#远程部署)

## 快速开始

clone 下来一条命令就能跑——缺依赖自动装、缺产物自动构建：

```bash
git clone <repo> && cd xdoc
./xdoc
```

首次运行会在 `~/.xdoc` 下植入示例空间并自动打开浏览器。其余参数原样转给 CLI：

```bash
./xdoc ~/my-docs --port 4000     # 指定数据根目录与端口
./xdoc mcp                       # 启动 MCP stdio 服务
```

走 npm 也一样（`npm install` 结束时会自动触发 `prepare` 构建）：

```bash
npm install
npm start
```

开发模式（tsx 直跑源码，改完不用重新构建）：

```bash
npm run dev
```

### 后台运行（启动脚本）

`node dist/cli.js` 是前台进程，关掉终端就没了。要长期挂着用 `scripts/xdoc.sh`：

```bash
scripts/xdoc.sh start          # 后台启动，默认端口 1998（监听地址取自 config.json）
scripts/xdoc.sh status         # 运行状态（PID / 端口 / 健康检查）
scripts/xdoc.sh logs           # 跟踪日志
scripts/xdoc.sh restart
scripts/xdoc.sh stop
```

也可以走 npm，**注意 `-p` 之类的选项要用 `--` 分隔**，否则会被 npm 自己吃掉：

```bash
npm run service -- start -p 3000
npm run service -- status
```

- PID 与日志落在仓库的 `.run/` 下（已 gitignore），按端口区分
  （`xdoc-<端口>.pid` / `xdoc-<端口>.log`），因此可以同时挂多个实例，`-p` 决定操作哪一个
- 终端关掉不受影响
- 端口固定：被占用时**直接报错并指出占用者**，不会悄悄换端口。想换就 `-p` 指定
- `start` 会等健康检查通过才返回成功；已在运行时只报告，不会起第二个进程
- `stop` 会先确认 PID 确实属于本项目的 xdoc，避免 PID 被复用后误杀别的进程
- 支持 `XDOC_PORT` / `XDOC_HOST` / `XDOC_ROOT` 环境变量，`--root` 可指定数据根目录
- 构建产物缺失时自动构建；`src/` 比 `dist/` 新时会提醒（不擅自重建）
- 认 `<root>/config.json` 里的部署参数，因此令牌、https、监听地址都能配在文件里，
  命令行长什么样都不影响起停；具体见[远程部署](#远程部署)

### 部署到一台新服务器（初始化脚本）

`xdoc.sh` 管的是"环境齐了之后怎么起停"，`init.sh` 管的是"环境还不齐时怎么补齐"——
从一台只有 curl 的干净机器到服务跑起来：

```bash
scripts/init.sh --check-only      # 先自检：架构 / 发行版 / 内存 / 磁盘 / gzip / glibc / node / git / npm 源
scripts/init.sh --start           # 一条龙：装 Node → 装依赖 → 构建 → 后台启动
```

- **装 Node**：缺失或低于 18.17 时下载官方 tarball 到 `/usr/local`（挑机器上解得了的
  `.tar.gz` / `.tar.xz`），带 sha256 校验；nodejs.org 不通时自动回退阿里云镜像
- **幂等**：已有满足版本的 node、已有 `node_modules` 都会跳过，反复跑没事
- 可用内存不足 1.5G 时只警告；要它顺手加 swap 就 `--swap 2048`（会写 `/etc/fstab`，
  撤销方式脚本里会打印）
- 外网不通的机器：`--registry https://registry.npmmirror.com`；完全离线则得在本机
  连 `node_modules` 一起打包再传过去——构建时 `packages: 'external'`，
  **只拷 `dist/` 是跑不起来的**

前提是代码已经在服务器上（`scp` / `tar` / `git clone` 都行），脚本不负责拉代码。
其余选项见 `scripts/init.sh -h`。

## 远程部署

把 xdoc 挂在服务器上，本地浏览器与本地 Agent 就能直接读写服务器上的文档。

```
本地                                    服务器
浏览器  ──── http(s)://server:1998 ───►  xdoc
Agent   ──── http(s)://server:1998/mcp ─┘  └── <root>/spaces/…
```

### 1. 一条命令部署（在本地跑）

```bash
scripts/deploy.sh root@1.2.3.4
```

它 ssh 上去 clone（仓库是公开的，服务器上无需配 GitHub 密钥；已有代码就
`git pull`）→ 跑 `scripts/init.sh --start` → 从日志里取回令牌 → 打印访问地址、
MCP 端点与现成的 Agent 配置。**装 Node、装依赖、构建都在服务器上做**，本地只要
ssh 能免密登录。

> 端口默认 1998，其余选项见 `scripts/deploy.sh -h`；`--dry-run` 可以只看它打算
> 在服务器上执行什么。

代码已经在服务器上，或者想自己一步步来，就在服务器上跑：

```bash
git clone <repo> && cd xdoc
scripts/init.sh --start          # 装 Node → 装依赖 → 构建 → 后台启动，一条命令
```

`<root>/config.json`（默认 `~/.xdoc/config.json`）首次运行会自动生成，默认就写成
**能对外用**的样子——监听 `0.0.0.0` + 随机令牌，权限 0600：

```json
{
  "host": "0.0.0.0",
  "token": "N3f...（自动生成的随机串）"
}
```

**令牌会打印在启动横幅里**，也是唯一需要记住的东西：

```
  xdoc 已启动 -> http://localhost:1998
  访问令牌： N3f...（复制这串）
  MCP 端点： http://localhost:1998/mcp
```

服务器上让进程跑在后台、拿启动横幅与日志：

```bash
scripts/xdoc.sh start      # 后台启动（读 config.json）
scripts/xdoc.sh logs       # 看横幅里的令牌
```

环境已经齐了也可以前台跑：`./xdoc`。

想换令牌或改端口，编辑 config.json 后 `scripts/xdoc.sh restart`。

`token` 是**共享令牌**，一个字符串就够了。启动后：

- `/api/*` 与 `/mcp` 都要求 `Authorization: Bearer <令牌>`（浏览器里也可以用
  `?token=<令牌>`，因为 `<img>` 和 `EventSource` 设不了请求头）
- 静态资源（页面本身、`app.js`、`styles.css`）不要求令牌，否则页面都打不开，
  也就没法让你输入令牌
- 网页会弹一次令牌输入框，填对后存在浏览器里，往后不用再填
- 服务器没有令牌又想监听 `0.0.0.0`？xdoc 会**拒绝启动**，除非你明确加
  `--allow-anonymous`。手滑把读写删文档的接口开放给全网这件事，值得多一道拦截

默认生成的令牌就是个随机串，嫌长就自己换短一点的，反正只有你在用：

```json
{ "host": "0.0.0.0", "token": "xdoc" }
```

### 3. 放行端口

```bash
sudo ufw allow 1998/tcp           # 或者云厂商安全组 / firewalld
```

### 4. HTTPS（可选）

令牌走的是明文 HTTP，**只适合内网、VPN 或 SSH 隧道**。要过公网就配证书，
在 `config.json` 里加上（相对路径按数据根目录解析）：

```json
{
  "cert": "cert.pem",
  "key": "key.pem"
}
```

也可以临时 `./xdoc --cert cert.pem --key key.pem`。配好之后监听的就是 https，
站内所有链接、MCP 端点都会跟着变成 `https://`。想省掉管理证书这件事，
把 xdoc 挂在带证书的反向代理（nginx / Caddy）后面也可以。

### 5. 用 systemd 托管

```ini
# /etc/systemd/system/xdoc.service
[Unit]
Description=xdoc
After=network.target

[Service]
Type=simple
User=xdoc
WorkingDirectory=/opt/xdoc
ExecStart=/usr/local/bin/node /opt/xdoc/dist/cli.js --no-open
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now xdoc
```

监听地址、端口、令牌都写在 `config.json` 里，因此 `ExecStart` 不用带任何参数；
以哪个用户跑，就写哪个用户的 `<root>/config.json`。

### 6. 本地接上

浏览器直接开 `http://server:1998`，输入一次令牌即可。MCP 客户端的配置见
[MCP - 远程调用（HTTP 端点）](#远程调用http-端点)。

### 部署参数从哪来

命令行 > 环境变量 > `<root>/config.json`：

| 参数 | 命令行 | 环境变量 | config.json |
| --- | --- | --- | --- |
| 数据根目录 | `--root` / 位置参数 | `XDOC_ROOT` | — |
| 令牌 | `--token` | `XDOC_TOKEN` | `token` |
| 监听地址 | `--host` | `XDOC_HOST`（仅脚本） | `host` |
| 端口 | `-p` / `--port` | `XDOC_PORT`（仅脚本） | `port` |
| 证书 / 私钥 | `--cert` / `--key` | — | `cert` / `key` |

写成文件的好处：`scripts/xdoc.sh` 与 systemd 都不必带一长串参数，令牌也不会
出现在 `ps` 的输出里。

## 数据根目录（root）

所有数据都放在一个**数据根目录**下，与 xdoc 的代码仓库分离：

```
<root>/                  # 默认 ~/.xdoc
├── index.json           # 空间索引：格式版本 / 展示顺序 / 上次活跃空间
├── config.json          # 部署参数：token / host / port / cert / key（首次运行自动生成）
├── spaces/              # 每个子目录是一个空间
│   ├── examples/
│   └── my-notes/
└── trash/               # 被移除的空间（不直接删除用户文档）
```

启动时可指定 root，不指定就用默认值：

```bash
xdoc                 # ~/.xdoc
xdoc ~/my-docs       # 位置参数
xdoc --root ~/my-docs
XDOC_ROOT=~/my-docs xdoc
```

**首次初始化**（`spaces/` 还不存在）时，仓库 `templates/` 下的示例空间会被复制进 `<root>/spaces/`，方便直接上手。之后即使把空间全删了也不会再次植入。

root 默认落在用户主目录，不在仓库内，因此文档不会随 xdoc 自身的 git 提交。

## 空间（Spaces）

每个空间 = `<root>/spaces/` 下一个自包含的文件夹，彼此隔离：

```
<root>/spaces/my-space/
├── meta.json        # 空间身份：id / 名称 / 备注 / 时间戳
├── xdoc.config.ts   # 空间级扩展（可选）
└── doc/             # 文档根目录，所有 markdown 与图片资源
    ├── index.md
    └── guide/intro.md
```

- 独立的目录树与文档，全部位于 `doc/` 之下
- 独立的 `xdoc.config.ts`：自定义嵌入体、CSS 互不影响，均支持热加载
- 独立的文件监听，扩展改动只影响当前空间

**空间 id 存在 `meta.json` 里**，生成一次就固定下来，因此空间目录可以整体移动、改名、复制或纳入 git，身份与元数据都跟着目录走。后续要加模板、附件之类的空间级能力，直接在空间根下开新目录即可，不会和文档混淆。

`index.json` 只记录展示顺序与上次活跃空间，名称和备注一律以各空间的 `meta.json` 为准，不做冗余存储。

空间管理都在网页里完成，**界面不暴露任何文件系统路径**：

1. **新建**：空间菜单点「新建空间」，填名称与备注即可。目录名由名称派生（中文可直接作目录名，空格与符号压成 `-`，重名追加 `-2`），自动生成 `meta.json` 与 `doc/index.md`
2. **切换**：点空间菜单里的空间项
3. **改名 / 改备注**：悬停空间项点铅笔图标，改动写回该空间的 `meta.json`
4. **移除**：悬停空间项点垃圾桶图标。空间目录被移进 `<root>/trash/<目录名>-<时间戳>/`，文档一个字节都不会丢，想恢复把目录 `mv` 回 `spaces/` 即可（服务端保证至少保留一个空间）

直接把一个符合结构的空间目录丢进 `<root>/spaces/` 也能被识别，重启后出现在列表末尾。

URL 结构为 `#/空间id/文档路径`，切换空间时会记住每个空间上次阅读的文档。

### 旧目录自动迁移

早期版本把 `.md` 直接放在空间根下。这类平铺目录在启动时会**自动迁移**：建好 `doc/`，把除 `meta.json`、`xdoc.config.*` 以外的条目整体移进去（图片等资源一起走，文内相对链接不会断），再生成 `meta.json`。迁移是幂等的，已有 `meta.json` 的空间不会被二次处理。

早期版本的全局注册表 `~/.xdoc/spaces.json` 允许空间散落在任意路径，新模型下没有对应物。启动时若检测到它，会打印仍然存在的目录并提示用 `mv` 搬进 `<root>/spaces/`，不会擅自移动用户文档。

## 文档管理

空间内的文档按目录树组织，均位于 `doc/` 之下（接口里的相对路径以 `doc/` 为根，不需要带 `doc/` 前缀）：

- 侧边栏工具栏可按文档根目录**新建文件 / 新建文件夹**
- 悬停目录行可**在该目录内新建**，悬停任意行可**重命名 / 删除**（目录删除需确认，级联删除）
- 文件名不带 `.md` 时自动补全；新建后自动打开
- 文件夹与文件**统一按名称排序**（自然排序，如 `2` 在 `10` 前）
- 以 `.` 开头的文件和目录不会显示，也不能通过接口创建

### 导出为 HTML

顶部工具栏右侧的下载按钮可以把当前文档导出成**单个自包含的 HTML 文件**，直接下载到本地，离线打开即可阅读。

导出完全在浏览器里完成——渲染好的 DOM 序列化下来即可，服务端不参与，也不会重新渲染一遍：

| 内容 | 导出后的形态 |
| --- | --- |
| mermaid 图 | 内联 SVG |
| echarts 图 | canvas 转成内联 PNG |
| 文档里的图片 | 抓取后转 base64 `data:` |
| 全局样式与空间自定义 CSS | 内联 `<style>` |

导出的文件不含任何脚本，亮/暗主题跟随导出时的界面主题。图表源码块与「复制代码」按钮会被去掉，标题锚点改为页内跳转。

正文标题在 2 个以上时会额外生成一份**「本文目录」**（与应用里右侧面板同一套取舍），插在大标题之后：纯页内锚点链接，没有脚本，收起/展开用原生 `<details>`，所以离线打开也能折叠。

## 内置嵌入体

共五个：`html`、`highlight`、`table`、`mermaid`、`echarts`。

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

### table —— 表格容器

```markdown
:::table title="参数说明" zebra bordered compact
| 字段 | 类型 |
| --- | --- |
| id | string |
:::
```

样式开关：`zebra`（斑马纹）、`bordered`（完整边框）、`compact`（紧凑）。

内容以 `<table>` / `<tr>` 等标签开头时按**原始 HTML** 处理，不做 markdown 解析，因此可以用 `colspan` / `rowspan` 合并单元格（markdown 表格语法做不到）：

```markdown
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
```

只写 `<tr>` 之类的片段也可以，会自动补一层 `<table>`。

### mermaid —— 图表

别名 `diagram`。块内写 mermaid 源码，流程图、时序图、状态图、甘特图、类图都支持：

```markdown
:::mermaid title="发布流程"
flowchart LR
  A[开发] --> B[测试] --> C[上线]
:::
```

### echarts —— 数据图表

别名 `chart`。块内写 ECharts 的 option，JSON 与 JS 对象字面量都可以，`height` 指定高度（纯数字按 px，默认 340px）：

```markdown
:::echarts title="每周新增" height=300
{
  tooltip: { trigger: 'axis' },
  xAxis: { type: 'category', data: ['第1周', '第2周', '第3周'] },
  yAxis: { type: 'value' },
  series: [{ type: 'bar', data: [12, 19, 24] }]
}
:::
```

两个图表都在浏览器端渲染，跟随亮暗主题重绘。库体积大（echarts ~1MB，mermaid 分块合计 ~5MB），因此都不进主 bundle：echarts 打进 `dist/public/vendor/echarts.js`，mermaid 直接拷贝官方 esm 产物到 `dist/public/vendor/mermaid/` 以复用它的懒加载分块。**文档里没有对应嵌入体时完全不加载**；有 mermaid 时也只拉取用到的图类型（流程图不会下载时序图的分块）。

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

在空间根目录（与 `meta.json` 同级，不是 `doc/` 里）创建 `xdoc.config.ts`（支持 `.mts` / `.js` / `.mjs`），保存后自动热加载。**每个空间有独立的配置文件**。

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

内置零依赖 MCP，两种接法：本机用 stdio，远程用 HTTP 端点。工具与语义完全一致。

### 本机（stdio）

```bash
# 直接运行（默认 ~/.xdoc）
node dist/cli.js mcp

# 指定数据根目录
node dist/cli.js mcp ~/my-docs
```

Claude Code / Claude Desktop 配置示例：

```json
{
  "mcpServers": {
    "xdoc": {
      "command": "node",
      "args": ["/absolute/path/to/xdoc/dist/cli.js", "mcp"]
    }
  }
}
```

### 远程调用（HTTP 端点）

服务端启动时就地提供一个 Streamable HTTP 端点 `POST /mcp`，**不用额外起进程**，
并且与网页端共用同一份空间运行时——Agent 写进去的文档，网页端通过文件监听
立刻就能看到，反之亦然。

```bash
curl -X POST http://server:1998/mcp \
  -H 'Authorization: Bearer <令牌>' \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

端点行为：

- 请求带 `id` → 200，回一条 JSON-RPC 响应；`Accept: text/event-stream` 的客户端
  则按事件流回（`event: message`）
- 纯通知（没有 `id`）→ 202，无消息体
- 支持 JSON-RPC 批量数组
- 只接受 `POST`，其他方法回 405 + `Allow: POST`
- 无状态，不分配 `Mcp-Session-Id`
- 校验 `Origin` 与 `Host` 是否一致，不一致回 403 —— 挡住浏览器页面跨站打这个端点
  的 DNS rebinding
- 受令牌保护，与 `/api/*` 同一套（`Authorization: Bearer` 或 `?token=`）

客户端配置：支持 Streamable HTTP 的客户端直接填 URL 与令牌。Claude Desktop 目前
需要 `mcp-remote` 之类的桥接：

```json
{
  "mcpServers": {
    "xdoc-remote": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "http://server:1998/mcp",
        "--header",
        "Authorization: Bearer ${XDOC_TOKEN}"
      ],
      "env": { "XDOC_TOKEN": "你的令牌" }
    }
  }
}
```

不想让令牌出现在进程列表里（本机其他用户 `ps` 就能看到），改用 `--header-file`，
把 `Authorization: Bearer <令牌>` 写进一个只有自己能读的文件。

明文 HTTP 只适合内网、VPN 或 SSH 隧道，详见[远程部署](#远程部署)。

### 工具列表

| 工具 | 说明 |
| --- | --- |
| `list_spaces` | 空间列表（含备注、目录、文档数） |
| `create_space` | 按名称新建空间（目录自动建在 `<root>/spaces/` 下，生成 meta.json 与 doc/index.md） |
| `update_space` | 更新空间名称 / 备注 |
| `list_docs` | 列出空间内全部 markdown 路径 |
| `read_doc` | 读取文档（markdown 原文或 html 预览） |
| `write_doc` | 创建 / 覆盖文档（自动补 `.md`、自动建父目录） |
| `append_doc` | 追加内容到文档末尾 |
| `edit_doc` | 精确文本替换（命中多处需 `replace_all`） |
| `move_doc` | 重命名 / 移动文件或目录 |
| `delete_doc` | 删除文件；目录需 `recursive: true` |
| `search_docs` | 空间内全文检索，返回路径 + 行号 + 片段 |
| `list_embeds` | 列出已注册嵌入体语法与示例（写文档时可直接用） |
| `style_guide` | xdoc 排版指南：嵌入体用法与写作约定 |
| `render_markdown` | 把 markdown 按空间扩展渲染为 HTML（验证自定义语法） |

### 让 Agent 写出排版规范的文档

MCP 的 `initialize` 响应里直接带上排版指南，Agent 一连接就知道有哪些嵌入体、该怎么用；指南内容也可以随时通过 `style_guide` 工具取回。配套的约定是：

- 结论、前置条件、风险分别用 `:::tip` / `:::warning` / `:::danger`，不埋在段落里
- 结构化数据进 `:::table`（需要合并单元格就写 HTML）
- 流程、架构画 `:::mermaid`，趋势、占比画 `:::echarts`
- 写完后用 `render_markdown` 验证语法

这样 Agent 产出的文档在网页端就是排版好的形态，而不是一大段纯文字。

工具都支持 `space` 参数（id 或名称，缺省第一个空间），路径为空间内相对于 `doc/` 的路径。MCP 与网页端共享同一个数据根目录，因此两边看到的空间完全一致；远程 HTTP 端点更直接——它与网页端是**同一个进程**，共用一个空间运行时，不存在两份视图。

与网页端不同，`list_spaces` / `create_space` 会返回空间的真实目录（`dir` / `docRoot`）—— Agent 需要知道文件实际落在哪里。走远程端点时返回的是**服务器上**的路径。

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
xdoc [数据根目录] [选项]     启动本地文档站点
xdoc mcp [数据根目录]        启动 MCP stdio 服务

不传数据根目录时使用 ~/.xdoc，也可用 XDOC_ROOT 环境变量指定。
空间在网页中切换、新建与移除，无需在命令行指定。

选项（优先级：命令行 > 环境变量 > <root>/config.json）：
      --root <路径>   数据根目录（等价于位置参数）
  -p, --port <端口>   监听端口（默认 1998）。不显式指定时，被占用会自动 +1 重试
                      （1998、1999…）；显式指定则直接报错，不会悄悄换端口
      --host <地址>   监听地址（默认 127.0.0.1）
      --token <令牌>  访问令牌，等价于 XDOC_TOKEN；设了则 /api/* 与 /mcp 都要令牌
      --cert <路径>   TLS 证书（PEM），与 --key 一起用则提供 https
      --key <路径>    TLS 私钥（PEM）
      --allow-anonymous
                      监听非本机地址时不设令牌（默认拒绝启动）
      --no-open       不自动打开浏览器
  -h, --help          显示帮助
  -v, --version       显示版本
```

远程部署怎么配见[远程部署](#远程部署)。

## 项目结构

```
xdoc                    # 一键入口：缺依赖自动装、缺产物自动构建，然后转发给 CLI
scripts/
├── deploy.sh           # 本地一条命令部署到远程服务器（ssh + clone + init.sh）
├── xdoc.sh             # 后台服务管理（start / stop / restart / status / logs）
├── init.sh             # 新机器初始化（装 Node → 装依赖 → 构建 → 启动）
└── build.mjs           # 构建 dist/cli.js 与前端资源
src/
├── core/               # 渲染核心（无服务端依赖，可独立复用）
│   ├── renderer.ts     # markdown-it 集成 + ::: 块级解析 + 嵌入体渲染
│   ├── registry.ts     # 嵌入体注册表
│   ├── attrs.ts        # key=value 参数解析
│   └── embeds/         # 内置嵌入体 html / highlight / table / mermaid / echarts
├── server/
│   ├── index.ts        # HTTP 服务与路由
│   ├── root.ts         # 数据根目录：解析、首次植入模板、目录名派生
│   ├── space.ts        # SpaceManager：多空间运行时（dir + docRoot/监听/配置热加载）
│   ├── meta.ts         # 空间身份与目录初始化（meta.json、doc/、旧目录迁移）
│   ├── operations.ts   # 文档操作：新建/写入/替换/移动/删除/检索（HTTP 与 MCP 共用）
│   ├── bootstrap.ts    # 扫描 <root>/spaces 装载空间
│   ├── persistence.ts  # 空间索引（<root>/index.json）
│   ├── tree.ts         # markdown 目录树扫描（统一按名排序，隐藏 . 开头）
│   └── config.ts       # xdoc.config.ts 加载与编译
├── mcp/
│   └── server.ts       # 零依赖 MCP stdio 服务（JSON-RPC）
├── client/             # 浏览器端：空间切换、路由、目录树管理、TOC、交互增强
│   └── diagram.ts      # mermaid / echarts 的按需加载与渲染（跟随主题重绘）
└── cli.ts
```

服务接口（除 `/api/spaces` 外均可用 `?space=<id>` 指定空间，缺省第一个空间）。**空间相关响应只含 id、名称、备注与时间戳，不含任何文件系统路径**：

| 接口 | 说明 |
| --- | --- |
| `GET /api/spaces` | 空间列表 |
| `POST /api/spaces` | 新建空间 `{ name, description? }`，目录名由名称派生 |
| `PATCH /api/spaces` | 更新名称/备注 `{ id, name?, description? }` |
| `DELETE /api/spaces?id=` | 移除空间（目录移入 `<root>/trash/`） |
| `POST /api/mkdir` | 新建目录 `{ space?, path }` |
| `POST /api/file` | 新建文档 `{ space?, path, content? }` |
| `POST /api/rename` | 重命名/移动 `{ space?, from, to }` |
| `DELETE /api/entry` | 删除文件/目录 `?space=&path=&recursive=` |
| `GET /api/tree` | markdown 目录树 |
| `GET /api/doc?path=` | 渲染文档为 HTML |
| `GET /api/raw?path=` | 原始 markdown |
| `GET /api/asset?path=` | `doc/` 内的静态资源 |
| `GET /api/embeds` | 已注册嵌入体列表 |
| `GET /api/styles` | 自定义 CSS |
| `GET /api/events` | SSE：change / tree / config / spaces |
| `POST /mcp` | MCP Streamable HTTP 端点（JSON-RPC） |

配了令牌时 `/api/*` 与 `/mcp` 都要求 `Authorization: Bearer <令牌>`，也可以换成
`?token=<令牌>`；静态资源不受影响。见[远程部署](#远程部署)。

## 开发

```bash
npm run typecheck   # 类型检查
npm test            # 单元测试（node:test）
npm run build       # 构建 dist/cli.js 与前端资源
npm run dev         # 构建后以 tsx 运行 examples
```