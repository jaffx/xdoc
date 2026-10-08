# xdoc 示例文档

xdoc 是一个支持**自定义嵌入体语法**的 Markdown 文档浏览工具：

- 完整支持 markdown 原生语法（标题、列表、表格、代码块、引用……）
- 通过 `:::名称 参数 ... :::` 定义块级扩展语法
- 扩展 = **语法 + 渲染逻辑**，通过 `registerEmbed` 注册，配置热加载
- 本地浏览：目录树、搜索、TOC、实时刷新、代码高亮、亮暗主题

## 示例目录

- [内置嵌入体演示](./embeds.md) —— html、高亮块、TODO、表格
- [自定义嵌入体指南](./custom-embed.md) —— 如何注册自己的语法

## 一个最小的自定义扩展

```ts
export default function setup({ registerEmbed }) {
  registerEmbed({
    name: 'badge',
    render: (ctx) => `<span class="badge">${ctx.escapeHtml(ctx.content.trim())}</span>`,
  });
}
```

注册后即可在文档中使用：

```markdown
:::badge
新功能
:::
```

:::tip 提示
本项目的 `xdoc.config.ts` 里已经注册了 `badge`、`card` 两个自定义嵌入体，可以直接在文档中体验。
:::

## 原生语法速览

> 引用块、**加粗**、*斜体*、`行内代码`、[链接](https://example.com) 都照常工作。

| 特性 | 状态 |
| --- | --- |
| markdown 渲染 | 支持 |
| 自定义语法 | 支持 |
| 热更新 | 支持 |

```ts
const hello = (name: string) => `你好，${name}`;
console.log(hello('xdoc'));
```