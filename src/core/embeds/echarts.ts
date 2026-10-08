import type { EmbedDefinition } from '../types';

const DEFAULT_HEIGHT = '340px';

/** 纯数字按 px 处理，其余原样作为 CSS 长度 */
function toLength(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  return /^\d+(\.\d+)?$/.test(value) ? `${value}px` : value;
}

/**
 * :::echarts title="..." height=360 —— ECharts 图表
 *
 * 块内是 ECharts 的 option（JSON 或 JS 对象字面量），不做 markdown 解析。
 * 渲染为占位容器，由浏览器端解析 option 并按当前主题绘制（见 client/diagram.ts）。
 */
export const echartsEmbed: EmbedDefinition = {
  name: 'echarts',
  aliases: ['chart'],
  description: 'ECharts 图表（折线、柱状、饼图、散点等），块内写 ECharts option（JSON 或 JS 对象字面量）',
  example:
    ':::echarts title="周访问量" height=320\n{\n  xAxis: { type: "category", data: ["一", "二", "三"] },\n  yAxis: { type: "value" },\n  series: [{ type: "bar", data: [120, 200, 150] }]\n}\n:::',
  render: (ctx) => {
    const title = ctx.attrs.title ?? ctx.positional.join(' ');
    const titleHtml = title ? `<figcaption>${ctx.escapeHtml(title)}</figcaption>` : '';
    const height = ctx.escapeHtml(toLength(ctx.attrs.height, DEFAULT_HEIGHT));
    const source = ctx.escapeHtml(ctx.content.trim());
    return [
      '<figure class="xdoc-echarts" data-xdoc-echarts>',
      titleHtml,
      `<div class="xdoc-echarts__view" style="height:${height}"></div>`,
      `<pre class="xdoc-diagram__src" hidden>${source}</pre>`,
      '</figure>\n',
    ].join('');
  },
};
