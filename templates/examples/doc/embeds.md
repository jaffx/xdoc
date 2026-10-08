# 内置嵌入体演示

下面依次演示内置的五种嵌入体。嵌入体内部都支持完整的 markdown，并且可以互相嵌套（外层使用更长的冒号标记）。

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

## 3. 表格块 (table)

`:::table` 为表格加上容器、标题与样式开关：`zebra`、`bordered`、`compact`。

markdown 表格写法：

:::table title="registerEmbed 参数说明" zebra
| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `name` | `string` | 是 | 语法名称，对应 `:::name` |
| `aliases` | `string[]` | 否 | 别名列表 |
| `render` | `(ctx) => string` | 是 | 渲染逻辑，返回 HTML |
| `description` | `string` | 否 | 说明文字 |
:::

内容直接写原始 HTML 时不做 markdown 解析，因此可以用 `colspan` / `rowspan` 合并单元格：

:::table title="分区域销量（合并单元格）" bordered
<table>
  <thead>
    <tr><th rowspan="2">区域</th><th colspan="2">上半年</th><th colspan="2">下半年</th></tr>
    <tr><th>销量</th><th>同比</th><th>销量</th><th>同比</th></tr>
  </thead>
  <tbody>
    <tr><td>华东</td><td>1,280</td><td>+12%</td><td>1,460</td><td>+14%</td></tr>
    <tr><td>华北</td><td>960</td><td>+5%</td><td>1,020</td><td>+6%</td></tr>
    <tr><td><strong>合计</strong></td><td colspan="2">2,240</td><td colspan="2">2,480</td></tr>
  </tbody>
</table>
:::

只写 `<tr>` 之类的片段也可以，会自动补一层 `<table>`：

:::table title="表格片段" bordered compact
<tr><th>选项</th><th>效果</th></tr>
<tr><td><code>zebra</code></td><td>斑马纹</td></tr>
<tr><td><code>bordered</code></td><td>完整边框</td></tr>
<tr><td><code>compact</code></td><td>紧凑内边距</td></tr>
:::

## 4. mermaid 图表

`:::mermaid`（别名 `:::diagram`）块内写 mermaid 源码，流程图、时序图、状态图、甘特图都支持，图表会跟随亮暗主题重绘。

:::mermaid title="文档渲染流程"
flowchart LR
  A[markdown] --> B{遇到 :::name?}
  B -- 是 --> C[查注册表]
  C --> D[执行 render]
  B -- 否 --> E[markdown-it 渲染]
  D --> F[HTML]
  E --> F
:::

:::mermaid title="空间切换时序"
sequenceDiagram
  participant U as 浏览器
  participant S as xdoc 服务
  U->>S: GET /api/spaces
  S-->>U: 空间列表
  U->>S: GET /api/tree?space=xxx
  S-->>U: 目录树
  U->>S: GET /api/doc?path=index.md
  S-->>U: 渲染后的 HTML
:::

## 5. echarts 图表

`:::echarts`（别名 `:::chart`）块内写 ECharts 的 option，支持 JSON 与 JS 对象字面量两种写法，`height` 可指定高度（纯数字按 px）。

:::echarts title="每周文档新增数" height=300
{
  tooltip: { trigger: 'axis' },
  grid: { left: 40, right: 20, top: 30, bottom: 30 },
  xAxis: { type: 'category', data: ['第1周', '第2周', '第3周', '第4周', '第5周'] },
  yAxis: { type: 'value' },
  series: [
    { name: '新增', type: 'bar', data: [12, 19, 8, 24, 17] },
    { name: '累计', type: 'line', smooth: true, data: [12, 31, 39, 63, 80] }
  ]
}
:::

:::echarts title="嵌入体使用占比" height=320
{
  tooltip: { trigger: 'item' },
  legend: { bottom: 0 },
  series: [{
    type: 'pie',
    radius: ['42%', '66%'],
    data: [
      { value: 42, name: 'highlight' },
      { value: 26, name: 'table' },
      { value: 18, name: 'mermaid' },
      { value: 9, name: 'echarts' },
      { value: 5, name: 'html' }
    ]
  }]
}
:::

## 6. 嵌套演示

外层使用四个冒号 `::::`，内层使用三个冒号 `:::`：

::::card title="外层 card（自定义嵌入体）"
卡片内部可以放其他嵌入体：

:::warning 嵌套的警告块
注意闭合标记的层级：外层 `::::`，内层 `:::`。
:::

:::mermaid title="卡片里的图"
flowchart TD
  A[外层四个冒号] --> B[内层三个冒号]
:::
::::

## 未注册的嵌入体

如果使用了未注册的名称，xdoc 会渲染一个提示块帮助你定位问题：

:::not-registered 某个参数
这段内容会被展示在提示块里。
:::
