# 自定义嵌入体指南

xdoc 的扩展机制：**定义语法 + 编写渲染逻辑**，然后 `registerEmbed` 注册。

## 1. 创建配置文件

在文档根目录创建 `xdoc.config.ts`（也支持 `.mts` / `.js` / `.mjs`）：

```ts
import type { EmbedRenderContext } from 'xdoc';

export default function setup({ registerEmbed, addStyles }) {
  addStyles(`
    .xdoc-badge {
      display: inline-block;
      padding: 2px 10px;
      border-radius: 999px;
      background: #4f7cff;
      color: #fff;
      font-size: 12px;
      font-weight: 600;
    }
  `);

  registerEmbed({
    name: 'badge',
    description: '彩色标签',
    render: (ctx: EmbedRenderContext) => {
      const color = ctx.attrs.color ?? 'blue';
      return `<span class="xdoc-badge" data-color="${ctx.escapeHtml(color)}">${ctx.escapeHtml(ctx.content.trim())}</span>`;
    },
  });
}
```

保存后 xdoc 会**热加载配置**，无需重启服务。

## 2. 在文档中使用

```markdown
:::badge color=green
已上线
:::
```

效果：

:::badge color=green
已上线
:::

:::badge color=red
已废弃
:::

:::badge
默认颜色
:::

## 渲染上下文 (ctx)

`render(ctx)` 收到的上下文字段：

| 字段 | 说明 |
| --- | --- |
| `name` | 实际命中的名称（别名会保留原样） |
| `params` | `:::name` 之后的原始参数字符串 |
| `attrs` | `key=value` 解析结果（支持引号） |
| `positional` | 非 `key=value` 的位置参数 |
| `content` | 块内原始 markdown 文本 |
| `env` | 渲染环境，可在嵌入体之间传递数据 |
| `render(md)` | 把 markdown 渲染成 HTML（递归解析嵌入体） |
| `renderInline(md)` | 只渲染行内 markdown，不产生 `<p>` |
| `escapeHtml(s)` | HTML 转义 |

### attrs 解析示例

```markdown
:::card title="带引号的标题" wide
...
:::
```

对应：

```ts
ctx.attrs      // { title: '带引号的标题' }
ctx.positional // ['wide']
```

## 3. 更完整的例子：card

`xdoc.config.ts` 中同时注册了一个 `card`，演示如何组合 `attrs`、`render` 与嵌套：

```ts
registerEmbed({
  name: 'card',
  aliases: ['panel'],
  render: (ctx) => {
    const title = ctx.attrs.title ?? ctx.positional.join(' ');
    const body = ctx.render(ctx.content);
    return `<div class="xdoc-card">
      ${title ? `<div class="xdoc-card__title">${ctx.escapeHtml(title)}</div>` : ''}
      <div class="xdoc-card__body">${body}</div>
    </div>`;
  },
});
```

使用效果：

:::card title="用户协议摘要"
内容由 markdown 渲染，可以放列表、代码和**其他嵌入体**：

- 支持 `ctx.render()` 递归渲染
- 支持属性解析

```ts
registerEmbed({ name: 'x', render: () => '<div/>' });
```
:::

## 4. 编程式使用

核心包也可作为库独立使用，不依赖服务端：

```ts
import { createRenderer } from 'xdoc';

const renderer = createRenderer();
renderer.registry.register({
  name: 'badge',
  render: (ctx) => `<b>${ctx.escapeHtml(ctx.content)}</b>`,
});

const html = renderer.render(':::badge\n你好\n:::');
```

:::tip 脱离服务使用
`createRenderer()` / `EmbedRegistry` / 内置嵌入体均从包根导出，可以在构建脚本、静态站点生成等场景复用同一份渲染逻辑。
:::