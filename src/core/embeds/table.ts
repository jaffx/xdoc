import type { EmbedDefinition } from '../types';

const MODIFIERS = ['zebra', 'bordered', 'compact'];

/** 内容以表格类标签开头时按原始 HTML 处理 */
const HTML_RE = /^<(table|thead|tbody|tfoot|tr|caption|colgroup)\b/i;
/** 片段（<tr> / <thead> 等）需要补一层 <table> */
const FRAGMENT_RE = /^<(thead|tbody|tfoot|tr|caption|colgroup)\b/i;

/**
 * :::table title="..." zebra —— 表格容器
 *
 * 内容写原始 HTML 时不做 markdown 解析，因此可以用 colspan / rowspan
 * 合并单元格；仍然兼容 markdown 表格写法（`| a | b |`）。
 */
export const tableEmbed: EmbedDefinition = {
  name: 'table',
  description: '表格容器，内容写原始 HTML 可用 colspan/rowspan 合并单元格，也兼容 markdown 表格',
  example:
    ':::table title="合并单元格" bordered\n<tr><th>区域</th><th colspan="2">销量</th></tr>\n<tr><td rowspan="2">华东</td><td>上海</td><td>120</td></tr>\n<tr><td>杭州</td><td>88</td></tr>\n:::',
  render: (ctx) => {
    const flags = MODIFIERS.filter((name) => ctx.attrs[name] !== undefined || ctx.positional.includes(name));
    const caption =
      ctx.attrs.title ?? ctx.attrs.caption ?? ctx.positional.filter((part) => !MODIFIERS.includes(part)).join(' ');
    const classes = ['xdoc-table', ...flags.map((flag) => `is-${flag}`)].join(' ');
    const captionHtml = caption ? `<figcaption>${ctx.escapeHtml(caption)}</figcaption>` : '';

    const source = ctx.content.trim();
    let body: string;
    if (HTML_RE.test(source)) {
      body = FRAGMENT_RE.test(source) ? `<table>${source}</table>` : source;
    } else {
      body = ctx.render(source).trim();
    }

    return `<figure class="${classes}">${captionHtml}<div class="xdoc-table__scroll">${body}</div></figure>\n`;
  },
};
