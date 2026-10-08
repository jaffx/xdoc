import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createMcpSession, type McpSession } from '../src/mcp/server';

interface RpcResponse {
  id: number;
  result?: { content?: Array<{ type: string; text: string }>; isError?: boolean; [key: string]: unknown };
  error?: { code: number; message: string };
}

async function call(session: McpSession, id: number, method: string, params: Record<string, unknown> = {}) {
  const response = (await session.handle({ jsonrpc: '2.0', id, method, params })) as RpcResponse;
  return response.result as NonNullable<RpcResponse['result']>;
}

async function callTool(session: McpSession, id: number, name: string, args: Record<string, unknown> = {}) {
  const result = await call(session, id, 'tools/call', { name, arguments: args });
  const text = result.content?.[0]?.text ?? '';
  return { payload: result.isError ? null : JSON.parse(text), isError: result.isError === true, text };
}

test('MCP：空间与文档的读写改查', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'xdoc-mcp-'));
  const dirA = path.join(root, 'spaces', 'docs');
  await mkdir(path.join(dirA, 'doc'), { recursive: true });
  await writeFile(path.join(dirA, 'doc', 'index.md'), '# 首页\n\nhello xdoc\n');

  const session = await createMcpSession({ root, write: () => {}, log: () => {} });
  try {
    // 握手
    const init = await call(session, 1, 'initialize', { protocolVersion: '2025-06-18' });
    assert.equal((init.serverInfo as { name: string }).name, 'xdoc');
    assert.equal(init.protocolVersion, '2025-06-18');

    const toolsList = await call(session, 2, 'tools/list');
    const names = (toolsList.tools as Array<{ name: string }>).map((tool) => tool.name);
    for (const expected of ['list_spaces', 'create_space', 'update_space', 'list_docs', 'read_doc', 'write_doc', 'append_doc', 'edit_doc', 'move_doc', 'delete_doc', 'search_docs', 'list_embeds', 'style_guide', 'render_markdown']) {
      assert.ok(names.includes(expected), `应包含工具 ${expected}`);
    }

    // 握手响应里带上排版指南，Agent 一连接就知道该怎么写
    const instructions = init.instructions as string;
    assert.match(instructions, /排版指南/);
    assert.match(instructions, /:::mermaid/);
    assert.match(instructions, /:::echarts/);

    // 排版指南工具：返回纯 markdown 文本（便于 Agent 直接读），因此不走 JSON 解析
    const guideResult = await call(session, 200, 'tools/call', { name: 'style_guide', arguments: {} });
    const guide = guideResult.content?.[0]?.text ?? '';
    assert.match(guide, /:::tip/);
    assert.match(guide, /rowspan/);
    assert.match(guide, /:::mermaid/);
    assert.match(guide, /:::echarts/);

    // 写入（自动补 .md、自动建父目录）并读取
    await callTool(session, 3, 'write_doc', { path: 'guide/intro', content: '# 指南\n\n第一段' });
    const read = await callTool(session, 4, 'read_doc', { path: 'guide/intro.md' });
    assert.match(read.payload.content as string, /第一段/);
    assert.equal(read.payload.path, 'guide/intro.md');

    // 精确替换
    await callTool(session, 5, 'edit_doc', { path: 'guide/intro.md', old_text: '第一段', new_text: '修改后' });
    const edited = await callTool(session, 6, 'read_doc', { path: 'guide/intro.md' });
    assert.match(edited.payload.content as string, /修改后/);

    // 替换失败返回 isError
    const badEdit = await callTool(session, 7, 'edit_doc', { path: 'guide/intro.md', old_text: '不存在的文本', new_text: 'x' });
    assert.equal(badEdit.isError, true);

    // 追加
    await callTool(session, 8, 'append_doc', { path: 'guide/intro.md', content: '## 附录' });
    const appended = await callTool(session, 9, 'read_doc', { path: 'guide/intro.md' });
    assert.match(appended.payload.content as string, /## 附录/);

    // 全文检索
    const search = await callTool(session, 10, 'search_docs', { query: 'hello xdoc' });
    assert.equal(search.payload.count, 1);
    assert.equal((search.payload.matches as Array<{ path: string }>)[0].path, 'index.md');

    // HTML 渲染
    const html = await callTool(session, 11, 'read_doc', { path: 'index.md', format: 'html' });
    assert.match(html.payload.html as string, /<h1>/);

    // 移动（无扩展名自动补 .md）
    await callTool(session, 12, 'move_doc', { from: 'guide/intro.md', to: 'guide/start' });
    const docs = await callTool(session, 13, 'list_docs');
    assert.ok((docs.payload.docs as string[]).includes('guide/start.md'));

    // 新建空间 + 元数据：目录由名称派生，建在 <root>/spaces 下
    const created = await callTool(session, 14, 'create_space', {
      name: '新空间',
      description: '备份笔记',
    });
    assert.equal(created.payload.created, true);
    const createdSpace = created.payload.space as { slug: string; dir: string; docRoot: string };
    assert.equal(createdSpace.slug, '新空间');
    assert.equal(createdSpace.dir, path.join(root, 'spaces', '新空间'));
    assert.equal(createdSpace.docRoot, path.join(root, 'spaces', '新空间', 'doc'));
    const createdId = (created.payload.space as { id: string }).id;
    await callTool(session, 15, 'update_space', { space: createdId, description: '更新备注' });
    const spaces = await callTool(session, 16, 'list_spaces');
    const target = (spaces.payload.spaces as Array<{ id: string; description: string }>).find((space) => space.id === createdId);
    assert.equal(target?.description, '更新备注');

    // 自定义语法渲染
    const rendered = await callTool(session, 17, 'render_markdown', { markdown: ':::warning 注意\n内容\n:::' });
    assert.match(rendered.payload.html as string, /xdoc-callout--warning/);

    // 内置嵌入体列表：带别名与示例，Agent 照着示例写
    const embeds = await callTool(session, 18, 'list_embeds');
    const entries = embeds.payload.embeds as Array<{ name: string; aliases: string[]; example: string | null }>;
    const embedNames = entries.map((embed) => embed.name);
    assert.ok(embedNames.includes('highlight') && embedNames.includes('mermaid'));
    assert.ok(embedNames.includes('echarts') && embedNames.includes('table'));
    assert.ok(!embedNames.includes('todo'));
    for (const name of ['highlight', 'table', 'mermaid', 'echarts', 'html']) {
      const entry = entries.find((embed) => embed.name === name);
      assert.ok(entry?.example, `嵌入体 ${name} 应带示例`);
      assert.match(entry!.example!, /:::/);
    }
    assert.ok(entries.find((embed) => embed.name === 'mermaid')!.aliases.includes('diagram'));

    // 删除目录
    await callTool(session, 19, 'delete_doc', { path: 'guide', recursive: true });
    const after = await callTool(session, 20, 'list_docs');
    assert.ok(!(after.payload.docs as string[]).some((doc) => doc.startsWith('guide/')));

    // 协议：通知不响应、未知方法报错
    assert.equal(await session.handle({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
    const unknown = (await session.handle({ jsonrpc: '2.0', id: 99, method: 'foo/bar' })) as RpcResponse;
    assert.equal(unknown.error?.code, -32601);
  } finally {
    await session.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('MCP：handleLine 输出标准 JSON-RPC 行', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'xdoc-mcp-line-'));
  const dir = path.join(root, 'spaces', 'docs');
  await mkdir(path.join(dir, 'doc'), { recursive: true });
  await writeFile(path.join(dir, 'doc', 'a.md'), '# A\n');

  const lines: string[] = [];
  const session = await createMcpSession({ root, write: (line) => lines.push(line), log: () => {} });
  try {
    await session.handleLine('{"jsonrpc":"2.0","id":1,"method":"ping"}');
    await session.handleLine('{"jsonrpc":"2.0","method":"notifications/initialized"}');
    await session.handleLine('not-json');
    await session.handleLine('');
    assert.equal(lines.length, 1);
    assert.deepEqual(JSON.parse(lines[0]), { jsonrpc: '2.0', id: 1, result: {} });
  } finally {
    await session.close();
    await rm(root, { recursive: true, force: true });
  }
});