import type { EmbedDefinition } from '../types';

/**
 * :::mermaid title="..." —— mermaid 图表
 *
 * 块内是 mermaid 源码，不做 markdown 解析。渲染为占位容器，
 * 由浏览器端按当前主题绘制 SVG（见 client/diagram.ts）。
 */
export const mermaidEmbed: EmbedDefinition = {
  name: 'mermaid',
  aliases: ['diagram'],
  description: 'mermaid 图表（流程图、时序图、甘特图、状态图、饼图等），块内写 mermaid 源码',
  example: ':::mermaid title="发布流程"\nflowchart LR\n  A[开发] --> B[测试]\n  B --> C[上线]\n:::',
  render: (ctx) => {
    const title = ctx.attrs.title ?? ctx.positional.join(' ');
    const titleHtml = title ? `<figcaption>${ctx.escapeHtml(title)}</figcaption>` : '';
    return `<figure class="xdoc-mermaid" data-xdoc-mermaid>${titleHtml}<div class="xdoc-mermaid__view"></div><pre class="xdoc-diagram__src" hidden>${ctx.escapeHtml(ctx.content.trim())}</pre></figure>\n`;
  },
};
