import type { EmbedDefinition } from '../types';

const MODIFIERS = ['zebra', 'bordered', 'compact'];

/** :::table title="..." zebra —— 带标题/样式的 markdown 表格 */
export const tableEmbed: EmbedDefinition = {
  name: 'table',
  description: 'markdown 表格容器，支持 title 与 zebra / bordered / compact 样式',
  example: ':::table title="参数说明" zebra\n| 字段 | 类型 |\n| --- | --- |\n| id | string |\n:::',
  render: (ctx) => {
    const flags = MODIFIERS.filter((name) => ctx.attrs[name] !== undefined || ctx.positional.includes(name));
    const caption =
      ctx.attrs.title ?? ctx.attrs.caption ?? ctx.positional.filter((part) => !MODIFIERS.includes(part)).join(' ');
    const classes = ['xdoc-table', ...flags.map((flag) => `is-${flag}`)].join(' ');
    const captionHtml = caption ? `<figcaption>${ctx.escapeHtml(caption)}</figcaption>` : '';
    const body = ctx.render(ctx.content).trim();
    return `${`<figure class="${classes}">`}${captionHtml}<div class="xdoc-table__scroll">${body}</div></figure>\n`;
  },
};