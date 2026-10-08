# 内置嵌入体演示

下面依次演示内置的四种嵌入体。所有嵌入体内部都支持完整的 markdown，并且可以互相嵌套（外层使用更长的冒号标记）。

## 1. html 嵌入体

`:::html` 会将内容原样输出为 HTML，不做 markdown 解析，适合嵌入 iframe、视频、自定义组件等。

:::html
<div style="padding:16px 18px;border:1px dashed #4f7cff;border-radius:12px;background:rgba(79,124,255,.06)">
  <strong>这是一段原始 HTML</strong>：<code>::::html ... ::::</code> 内的内容会原样输出。
</div>
:::

## 2. 高亮块 (highlight)

`:::highlight` 支持 `note`、`info`、`tip`、`success`、`warning`、`danger` 六种变体，这些变体同时也是别名。

:::note 说明
默认变体，用于补充说明。
:::

:::info 信息
支持 `type=xxx` 指定变体，也支持别名写法。
:::

:::tip 技巧
参数里的第一个位置参数会作为标题：`:::tip 技巧`。
:::

:::success 已完成
内部支持 **markdown**、列表、代码：

- 第一项
- 第二项 `code`
:::

:::warning 注意
这是一条警告信息。
:::

:::danger 危险
这是一条危险信息。
:::

显式指定变体与标题：

:::highlight type=warning title="自定义标题"
`:::highlight type=warning title="自定义标题"`。
:::

## 3. TODO 块

`:::todo` 会把 `- [ ]` / `- [x]` 解析为可交互的清单，并自动统计进度（勾选试试）：

:::todo title="xdoc 发布清单"
- [x] 搭建核心渲染层
- [x] 实现嵌入体注册 API
- [ ] 编写单元测试
- [ ] 发布到 npm
:::

非复选框内容会按普通 markdown 渲染在清单下方：

:::todo title="混合内容"
- [x] 支持复选框
- [ ] 支持其他 markdown

> 这段引用会渲染在清单下方。
:::

## 4. 表格块

`:::table` 为 markdown 表格加上容器、标题与样式开关：`zebra`、`bordered`、`compact`。

:::table title="registerEmbed 参数说明" zebra
| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `name` | `string` | 是 | 语法名称，对应 `:::name` |
| `aliases` | `string[]` | 否 | 别名列表 |
| `render` | `(ctx) => string` | 是 | 渲染逻辑，返回 HTML |
| `description` | `string` | 否 | 说明文字 |
:::

:::table title="紧凑 + 边框样式" bordered compact
| 选项 | 效果 |
| --- | --- |
| `zebra` | 斑马纹 |
| `bordered` | 完整边框 |
| `compact` | 紧凑内边距 |
:::

## 5. 嵌套演示

外层使用四个冒号 `::::`，内层使用三个冒号 `:::`：

::::card title="外层 card（自定义嵌入体）"
卡片内部可以放其他嵌入体：

:::warning 嵌套的警告块
注意闭合标记的层级：外层 `::::`，内层 `:::`。
:::

:::todo title="卡片里的待办"
- [x] 外层四个冒号
- [ ] 内层三个冒号
:::
::::

## 未注册的嵌入体

如果使用了未注册的名称，xdoc 会渲染一个提示块帮助你定位问题：

:::not-registered 某个参数
这段内容会被展示在提示块里。
:::