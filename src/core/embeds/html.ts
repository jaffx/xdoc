import type { EmbedDefinition } from '../types';

export const htmlEmbed: EmbedDefinition = {
  name: 'html',
  description: '直接嵌入原始 HTML，内容不做 markdown 解析',
  example: ':::html\n<div class="demo">任意 HTML</div>\n:::',
  render: (ctx) => {
    const className = ctx.attrs.class ? ` ${ctx.escapeHtml(ctx.attrs.class)}` : '';
    return `<div class="xdoc-embed-html${className}">\n${ctx.content}\n</div>\n`;
  },
};