import type { EmbedDefinition } from 'xdoc';

/**
 * xdoc 扩展示例：语法 + 渲染逻辑 = 一个嵌入体。
 * 修改此文件后服务会自动热加载（无需重启）。
 */
export default function setup(api: {
  registerEmbed: (definition: EmbedDefinition) => void;
  addStyles: (css: string) => void;
}) {
  api.addStyles(`
    .xdoc-badge {
      display: inline-block;
      padding: 2px 10px;
      border-radius: 999px;
      background: #4f7cff;
      color: #fff;
      font-size: 12px;
      font-weight: 600;
      line-height: 1.7;
    }
    .xdoc-badge[data-color="green"] { background: #10b981; }
    .xdoc-badge[data-color="red"] { background: #ef4444; }
    .xdoc-badge[data-color="orange"] { background: #f59e0b; }
    .xdoc-badge[data-color="purple"] { background: #8b5cf6; }

    .xdoc-card {
      margin: 1.1em 0;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: var(--panel);
      overflow: hidden;
    }
    .xdoc-card__title {
      padding: 10px 15px;
      border-bottom: 1px solid var(--border);
      background: var(--bg-soft);
      font-weight: 700;
      font-size: 14px;
    }
    .xdoc-card__body { padding: 4px 15px 12px; }
    .xdoc-card__body > :first-child { margin-top: 0.6em; }
    .xdoc-card__body > :last-child { margin-bottom: 0.6em; }
  `);

  api.registerEmbed({
    name: 'badge',
    description: '彩色标签（自定义扩展示例）',
    example: ':::badge color=green\n已上线\n:::',
    render: (ctx) => {
      const color = ctx.attrs.color ?? 'blue';
      return `<span class="xdoc-badge" data-color="${ctx.escapeHtml(color)}">${ctx.escapeHtml(ctx.content.trim())}</span>\n`;
    },
  });

  api.registerEmbed({
    name: 'card',
    aliases: ['panel'],
    description: '带标题的卡片容器（自定义扩展示例）',
    example: ':::card title="标题"\n内容\n:::',
    render: (ctx) => {
      const title = ctx.attrs.title ?? ctx.positional.join(' ');
      const titleHtml = title ? `<div class="xdoc-card__title">${ctx.escapeHtml(title)}</div>` : '';
      return `<div class="xdoc-card">${titleHtml}<div class="xdoc-card__body">${ctx.render(ctx.content)}</div></div>\n`;
    },
  });
}