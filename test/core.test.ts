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

test('todo 统计完成数量并渲染复选框', () => {
  const renderer = createRenderer();
  const html = renderer.render(':::todo title="清单"\n- [x] 完成项\n- [ ] 待办项\n:::');
  assert.match(html, /data-done="1"/);
  assert.match(html, /data-total="2"/);
  assert.match(html, /checked/);
  assert.match(html, /1\/2/);
});

test('table 包裹标题与样式', () => {
  const renderer = createRenderer();
  const html = renderer.render(':::table title="参数" zebra\n| a | b |\n| - | - |\n| 1 | 2 |\n:::');
  assert.match(html, /xdoc-table is-zebra/);
  assert.match(html, /<figcaption>参数<\/figcaption>/);
  assert.match(html, /<table>/);
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