import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createRegistry,
  createRenderer,
  EmbedRegistry,
  parseParams,
  type EmbedDefinition,
} from '../src/core/index';

test('parseParams 解析 key=value、引号与位置参数', () => {
  const { attrs, positional } = parseParams('type=warning title="重点 内容" zebra');
  assert.deepEqual(attrs, { type: 'warning', title: '重点 内容' });
  assert.deepEqual(positional, ['zebra']);
});

test('html 嵌入体原样输出', () => {
  const renderer = createRenderer();
  const html = renderer.render(':::html\n<b>xdoc</b>\n:::');
  assert.match(html, /<b>xdoc<\/b>/);
  assert.match(html, /xdoc-embed-html/);
});

test('highlight 别名与标题', () => {
  const renderer = createRenderer();
  const html = renderer.render(':::warning 注意标题\n**粗体**\n:::');
  assert.match(html, /xdoc-callout--warning/);
  assert.match(html, /注意标题/);
  assert.match(html, /<strong>粗体<\/strong>/);
});

test('highlight 显式 type 与 title', () => {
  const renderer = createRenderer();
  const html = renderer.render(':::highlight type=danger title="小心"\n内容\n:::');
  assert.match(html, /xdoc-callout--danger/);
  assert.match(html, /小心/);
});

test('table 包裹标题与样式', () => {
  const renderer = createRenderer();
  const html = renderer.render(':::table title="参数" zebra\n| a | b |\n| - | - |\n| 1 | 2 |\n:::');
  assert.match(html, /xdoc-table is-zebra/);
  assert.match(html, /<figcaption>参数<\/figcaption>/);
  assert.match(html, /<table>/);
});

test('table 原始 HTML 内容保留 colspan/rowspan', () => {
  const renderer = createRenderer();
  const html = renderer.render(
    ':::table title="合并" bordered\n<table>\n<tr><th colspan="2">销量</th></tr>\n<tr><td rowspan="2">华东</td><td>120</td></tr>\n</table>\n:::',
  );
  assert.match(html, /xdoc-table is-bordered/);
  assert.match(html, /colspan="2"/);
  assert.match(html, /rowspan="2"/);
  // 原始 HTML 不应被 markdown 解析包进 <p>
  assert.doesNotMatch(html, /<p>&lt;table/);
});

test('table 表格片段自动补 <table> 包裹', () => {
  const renderer = createRenderer();
  const html = renderer.render(':::table\n<tr><td colspan="2">片段</td></tr>\n:::');
  assert.match(html, /<table><tr><td colspan="2">片段<\/td><\/tr><\/table>/);
});

test('mermaid 渲染为占位容器并保留源码', () => {
  const renderer = createRenderer();
  const html = renderer.render(':::mermaid title="流程"\nflowchart LR\n  A --> B\n:::');
  assert.match(html, /data-xdoc-mermaid/);
  assert.match(html, /<figcaption>流程<\/figcaption>/);
  assert.match(html, /flowchart LR/);
  assert.match(html, /xdoc-diagram__src/);
});

test('echarts 渲染容器并支持 height 与转义', () => {
  const renderer = createRenderer();
  const html = renderer.render(':::echarts title="访问量" height=320\n{ "series": [{ "type": "bar" }] }\n:::');
  assert.match(html, /data-xdoc-echarts/);
  assert.match(html, /height:320px/);
  assert.match(html, /&quot;type&quot;: &quot;bar&quot;/);
});

test('echarts 别名 chart 与 mermaid 别名 diagram 可用', () => {
  const renderer = createRenderer();
  assert.match(renderer.render(':::chart\n{}\n:::'), /data-xdoc-echarts/);
  assert.match(renderer.render(':::diagram\ngraph TD\n:::'), /data-xdoc-mermaid/);
});

test('未注册嵌入体输出提示而非崩溃', () => {
  const renderer = createRenderer();
  const html = renderer.render(':::nope\n内容\n:::');
  assert.match(html, /xdoc-embed--unknown/);
  assert.match(html, /:::nope/);
});

test('缺少闭合标记时给出警告', () => {
  const renderer = createRenderer();
  const html = renderer.render(':::html\n<b>x</b>');
  assert.match(html, /xdoc-embed--warning/);
  assert.match(html, /<b>x<\/b>/);
});

test('自定义嵌入体可注册并拿到 attrs/positional/render', () => {
  const registry = createRegistry();
  registry.register({
    name: 'box',
    render: (ctx) =>
      `<section data-kind="${ctx.attrs.kind ?? 'plain'}" data-pos="${ctx.positional.join(',')}">${ctx.render(ctx.content)}</section>`,
  });
  const renderer = createRenderer({ registry });
  const html = renderer.render(':::box kind=tip wide\n**内容**\n:::');
  assert.match(html, /data-kind="tip"/);
  assert.match(html, /data-pos="wide"/);
  assert.match(html, /<strong>内容<\/strong>/);
});

test('更长的外层标记支持嵌套', () => {
  const registry = createRegistry();
  const card: EmbedDefinition = {
    name: 'card',
    render: (ctx) => `<div class="card">${ctx.render(ctx.content)}</div>`,
  };
  registry.register(card);
  const renderer = createRenderer({ registry });
  const html = renderer.render('::::card\n:::warning 内层\n文本\n:::\n::::');
  assert.match(html, /<div class="card">/);
  assert.match(html, /xdoc-callout--warning/);
  assert.equal((html.match(/<div class="card">/g) ?? []).length, 1);
});

test('别名注册与查询', () => {
  const registry = new EmbedRegistry();
  registry.register({ name: 'alert', aliases: ['warn'], render: () => '' });
  assert.equal(registry.get('warn')?.name, 'alert');
  assert.ok(registry.has('warn'));
  assert.deepEqual(registry.names(), ['alert', 'warn']);
  assert.equal(registry.list().length, 1);
  assert.ok(registry.unregister('warn'));
  assert.equal(registry.has('alert'), false);
});

test('渲染失败时输出错误提示而不是抛异常', () => {
  const registry = createRegistry();
  registry.register({
    name: 'boom',
    render: () => {
      throw new Error('炸了');
    },
  });
  const renderer = createRenderer({ registry });
  const html = renderer.render(':::boom\nx\n:::');
  assert.match(html, /xdoc-embed--error/);
  assert.match(html, /炸了/);
});