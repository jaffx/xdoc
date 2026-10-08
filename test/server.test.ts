import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { startServer } from '../src/server/index';

async function makeSpace(root: string, files: Record<string, string>) {
  await mkdir(root, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    await writeFile(path.join(root, name), content);
  }
}

test('多空间服务：列表 / 渲染 / 新增 / 删除 / 越界防护', async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'xdoc-spaces-'));
  process.env.XDOC_HOME = path.join(base, 'home');

  const rootA = path.join(base, 'docs');
  const rootB = path.join(base, 'notes');
  const rootC = path.join(base, 'wiki');
  await makeSpace(rootA, { 'index.md': '# A 空间\n\n:::warning\n警告内容\n:::' });
  await makeSpace(rootB, { 'readme.md': '# B 空间' });
  await makeSpace(rootC, { 'index.md': '# C 空间' });

  const server = await startServer({ roots: [rootA, rootB], port: 0 });
  const api = (route: string, init?: RequestInit) => fetch(`http://127.0.0.1:${server.port}${route}`, init);
  const json = async <T>(route: string, init?: RequestInit): Promise<T> => {
    const response = await api(route, init);
    assert.equal(response.status, 200, `${route} 应返回 200`);
    return response.json() as Promise<T>;
  };

  try {
    // 空间列表
    const spaces = await json<Array<{ id: string; name: string; root: string; source: string }>>('/api/spaces');
    assert.equal(spaces.length, 2);
    const spaceA = spaces.find((space) => space.root === rootA);
    const spaceB = spaces.find((space) => space.root === rootB);
    assert.ok(spaceA);
    assert.ok(spaceB);
    assert.equal(spaceA.source, 'cli');

    // 空间目录树与渲染
    const treeA = await json<Array<{ path: string }>>(`/api/tree?space=${spaceA.id}`);
    assert.deepEqual(treeA.map((node) => node.path), ['index.md']);
    const docA = await json<{ space: string; html: string }>(`/api/doc?space=${spaceA.id}&path=index.md`);
    assert.equal(docA.space, spaceA.id);
    assert.match(docA.html, /xdoc-callout--warning/);
    const docB = await json<{ html: string }>(`/api/doc?space=${spaceB.id}&path=readme.md`);
    assert.match(docB.html, /B 空间/);

    // 不同空间互不可见
    const crossResponse = await api(`/api/doc?space=${spaceA.id}&path=readme.md`);
    assert.ok(crossResponse.status >= 400);

    // 运行时新增空间（并持久化）
    const created = await json<{ space: { id: string; source: string }; created: boolean }>('/api/spaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: rootC }),
    });
    assert.equal(created.created, true);
    assert.equal(created.space.source, 'user');
    assert.equal((await json<unknown[]>('/api/spaces')).length, 3);

    // 重复添加返回已存在
    const again = await json<{ created: boolean }>('/api/spaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: rootC }),
    });
    assert.equal(again.created, false);

    // 删除空间
    await json<{ ok: boolean }>(`/api/spaces?id=${created.space.id}`, { method: 'DELETE' });
    assert.equal((await json<unknown[]>('/api/spaces')).length, 2);

    // 不允许删除最后一个空间
    await json(`/api/spaces?id=${spaceB.id}`, { method: 'DELETE' });
    const lastDelete = await api(`/api/spaces?id=${spaceA.id}`, { method: 'DELETE' });
    assert.equal(lastDelete.status, 400);

    // 路径越界
    const traversal = await api(`/api/doc?space=${spaceA.id}&path=../../etc/passwd`);
    assert.equal(traversal.status, 403);

    // 未知空间
    const unknown = await api('/api/tree?space=not-exist');
    assert.equal(unknown.status, 404);
  } finally {
    await server.close();
    await rm(base, { recursive: true, force: true });
  }
});
test('空间创建与元数据：备注、重命名、持久化恢复', async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'xdoc-meta-'));
  const home = path.join(base, 'home');
  process.env.XDOC_HOME = home;

  const rootA = path.join(base, 'docs');
  await makeSpace(rootA, { 'index.md': '# A' });
  const createdRoot = path.join(base, 'workspace', 'new-space');

  const first = await startServer({ roots: [rootA], port: 0 });
  const api = (route: string, init?: RequestInit) => fetch(`http://127.0.0.1:${first.port}${route}`, init);
  const json = async <T>(route: string, init?: RequestInit): Promise<T> => {
    const response = await api(route, init);
    assert.equal(response.status, 200, `${route} 应返回 200`);
    return response.json() as Promise<T>;
  };
  const post = (body: unknown, method = 'POST') =>
    json<{ space: { id: string; name: string; description?: string }; created: boolean }>('/api/spaces', {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  try {
    // 新建空间：目录不存在时自动创建并生成 index.md
    const created = await post({ path: createdRoot, name: '新空间', description: '这是我的备注', create: true });
    assert.equal(created.created, true);
    assert.equal(created.space.description, '这是我的备注');
    assert.ok(existsSync(path.join(createdRoot, 'index.md')));
    assert.match(await readFile(path.join(createdRoot, 'index.md'), 'utf8'), /# 新空间/);

    // 编辑元数据
    const updated = await json<{ name: string; description?: string }>('/api/spaces', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: created.space.id, name: '改名后', description: '备注已更新' }),
    });
    assert.equal(updated.name, '改名后');
    assert.equal(updated.description, '备注已更新');
    const spaces = await json<Array<{ id: string; name: string; description?: string }>>('/api/spaces');
    const renamed = spaces.find((space) => space.id === created.space.id);
    assert.equal(renamed?.name, '改名后');

    // 持久化文件包含元数据
    const registry = JSON.parse(await readFile(path.join(home, 'spaces.json'), 'utf8')) as {
      spaces: Array<{ root: string; name?: string; description?: string }>;
    };
    const entry = registry.spaces.find((item) => item.root === createdRoot);
    assert.equal(entry?.name, '改名后');
    assert.equal(entry?.description, '备注已更新');
    assert.ok(typeof (entry as { createdAt?: number }).createdAt === 'number');

    // 重启后恢复空间及元数据
    await first.close();
    const second = await startServer({ roots: [rootA], port: 0 });
    try {
      const restored = await (
        await fetch(`http://127.0.0.1:${second.port}/api/spaces`)
      ).json() as Array<{ id: string; name: string; description?: string; source: string }>;
      const space = restored.find((item) => item.name === '改名后');
      assert.ok(space, '重启后应恢复空间');
      assert.equal(space.description, '备注已更新');
      assert.equal(space.source, 'user');
    } finally {
      await second.close();
    }
  } finally {
    await first.close().catch(() => undefined);
    await rm(base, { recursive: true, force: true });
  }
});
