import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { request as httpsRequest } from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { startServer } from '../src/server/index';

/** 自签证书得靠 openssl 生成，没有就跳过 https 那条用例 */
const hasOpenssl = spawnSync('openssl', ['version'], { stdio: 'ignore' }).status === 0;

/** 空间目录：<root>/spaces/<slug>，文档写进其下的 doc/ */
function spaceDir(root: string, slug: string): string {
  return path.join(root, 'spaces', slug);
}

/** 按新结构造一个空间：文档写进 <root>/spaces/<slug>/doc/ */
async function makeSpace(root: string, slug: string, files: Record<string, string>) {
  const docRoot = path.join(spaceDir(root, slug), 'doc');
  await mkdir(docRoot, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(docRoot, name);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, content);
  }
}

/** 造一个旧式平铺空间：文档直接散在空间根下 */
async function makeFlatSpace(root: string, slug: string, files: Record<string, string>) {
  const dir = spaceDir(root, slug);
  await mkdir(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(dir, name);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, content);
  }
}

interface SpacePayload {
  id: string;
  name: string;
  description?: string;
  createdAt?: number;
  updatedAt?: number;
}

interface IndexFile {
  version: number;
  order: string[];
  lastActiveSpace?: string;
}

const readIndex = async (root: string): Promise<IndexFile> =>
  JSON.parse(await readFile(path.join(root, 'index.json'), 'utf8')) as IndexFile;

test('多空间服务：列表 / 渲染 / 新建 / 移除 / 越界防护', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'xdoc-spaces-'));
  await makeSpace(root, 'docs', { 'index.md': '# A 空间\n\n:::warning\n警告内容\n:::' });
  await makeSpace(root, 'notes', { 'readme.md': '# B 空间' });

  const server = await startServer({ root, port: 0 });
  const api = (route: string, init?: RequestInit) => fetch(`http://127.0.0.1:${server.port}${route}`, init);
  const json = async <T>(route: string, init?: RequestInit): Promise<T> => {
    const response = await api(route, init);
    assert.equal(response.status, 200, `${route} 应返回 200`);
    return response.json() as Promise<T>;
  };

  try {
    // 空间列表：名称取自目录名
    const spaces = await json<SpacePayload[]>('/api/spaces');
    assert.equal(spaces.length, 2);
    const spaceA = spaces.find((space) => space.name === 'docs');
    const spaceB = spaces.find((space) => space.name === 'notes');
    assert.ok(spaceA);
    assert.ok(spaceB);

    // 响应里不得出现任何文件系统路径
    for (const space of spaces) {
      assert.ok(!('dir' in space), '空间信息不应包含 dir');
      assert.ok(!('docRoot' in space), '空间信息不应包含 docRoot');
      assert.ok(!('slug' in space), '空间信息不应包含 slug');
    }

    // 空间目录树与渲染
    const treeA = await json<Array<{ path: string }>>(`/api/tree?space=${spaceA.id}`);
    assert.deepEqual(treeA.map((node) => node.path), ['index.md']);
    const docA = await json<{ space: string; html: string }>(`/api/doc?space=${spaceA.id}&path=index.md`);
    assert.equal(docA.space, spaceA.id);
    assert.match(docA.html, /xdoc-callout--warning/);
    const docB = await json<{ html: string }>(`/api/doc?space=${spaceB.id}&path=readme.md`);
    assert.match(docB.html, /B 空间/);

    // 阅读文档会记录上次活跃空间
    assert.equal((await readIndex(root)).lastActiveSpace, 'notes');

    // 不同空间互不可见
    const crossResponse = await api(`/api/doc?space=${spaceA.id}&path=readme.md`);
    assert.ok(crossResponse.status >= 400);

    // 按名称新建空间：目录名由名称派生
    const created = await json<{ space: SpacePayload; created: boolean }>('/api/spaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '维基' }),
    });
    assert.equal(created.created, true);
    assert.equal(created.space.name, '维基');
    assert.ok(existsSync(path.join(spaceDir(root, '维基'), 'doc', 'index.md')));
    assert.equal((await json<unknown[]>('/api/spaces')).length, 3);

    // 同名再建：目录名追加后缀，展示名去重，不会覆盖已有空间
    const duplicate = await json<{ space: SpacePayload; created: boolean }>('/api/spaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '维基' }),
    });
    assert.equal(duplicate.created, true);
    assert.notEqual(duplicate.space.id, created.space.id);
    assert.ok(existsSync(spaceDir(root, '维基-2')), '同名空间应落在 维基-2 目录');
    assert.equal(duplicate.space.name, '维基 2', '展示名应去重');

    // 缺少名称
    const noName = await api('/api/spaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(noName.status, 400);

    // 移除空间：目录移入 trash/，用户文档不被删除
    await json<{ ok: boolean }>(`/api/spaces?id=${duplicate.space.id}`, { method: 'DELETE' });
    assert.equal((await json<unknown[]>('/api/spaces')).length, 3);
    assert.ok(!existsSync(spaceDir(root, '维基-2')), '空间目录应从 spaces/ 移走');
    const trashed = await readdir(path.join(root, 'trash'));
    assert.ok(
      trashed.some((name) => name.startsWith('维基-2-')),
      '空间目录应保留在 trash/ 中',
    );

    // 路径越界
    const traversal = await api(`/api/doc?space=${spaceA.id}&path=../../etc/passwd`);
    assert.equal(traversal.status, 403);

    // 未知空间
    const unknown = await api('/api/tree?space=not-exist');
    assert.equal(unknown.status, 404);
  } finally {
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('空间创建与元数据：备注、重命名、重启恢复', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'xdoc-meta-'));
  await makeSpace(root, 'docs', { 'index.md': '# A' });

  const first = await startServer({ root, port: 0 });
  const api = (route: string, init?: RequestInit) => fetch(`http://127.0.0.1:${first.port}${route}`, init);
  const json = async <T>(route: string, init?: RequestInit): Promise<T> => {
    const response = await api(route, init);
    assert.equal(response.status, 200, `${route} 应返回 200`);
    return response.json() as Promise<T>;
  };

  try {
    // 新建空间：自动建目录，生成 meta.json 与 doc/index.md
    const created = await json<{ space: SpacePayload; created: boolean }>('/api/spaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '新空间', description: '这是我的备注' }),
    });
    assert.equal(created.created, true);
    assert.equal(created.space.description, '这是我的备注');

    const createdDir = spaceDir(root, '新空间');
    assert.ok(existsSync(path.join(createdDir, 'doc', 'index.md')));
    assert.match(await readFile(path.join(createdDir, 'doc', 'index.md'), 'utf8'), /# 新空间/);

    // meta.json 落盘，承载空间身份
    const meta = JSON.parse(await readFile(path.join(createdDir, 'meta.json'), 'utf8')) as {
      id: string;
      name: string;
      description?: string;
      createdAt: number;
    };
    assert.equal(meta.id, created.space.id);
    assert.equal(meta.name, '新空间');
    assert.equal(meta.description, '这是我的备注');
    assert.ok(typeof meta.createdAt === 'number');

    // 编辑元数据
    const updated = await json<SpacePayload>('/api/spaces', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: created.space.id, name: '改名后', description: '备注已更新' }),
    });
    assert.equal(updated.name, '改名后');
    assert.equal(updated.description, '备注已更新');

    // 元数据写回空间自己的 meta.json，目录名与 id 都不随改名变化
    const updatedMeta = JSON.parse(await readFile(path.join(createdDir, 'meta.json'), 'utf8')) as {
      id: string;
      name: string;
      description?: string;
    };
    assert.equal(updatedMeta.name, '改名后');
    assert.equal(updatedMeta.description, '备注已更新');
    assert.equal(updatedMeta.id, created.space.id, 'id 不随改名变化');

    // 索引记录空间顺序
    const index = await readIndex(root);
    assert.equal(index.version, 1);
    assert.deepEqual(index.order, ['docs', '新空间']);

    // 重启后恢复空间及元数据，且 id 不变
    await first.close();
    const second = await startServer({ root, port: 0 });
    try {
      const restored = (await (await fetch(`http://127.0.0.1:${second.port}/api/spaces`)).json()) as SpacePayload[];
      const space = restored.find((item) => item.name === '改名后');
      assert.ok(space, '重启后应恢复空间');
      assert.equal(space.description, '备注已更新');
      assert.equal(space.id, created.space.id, '重启后 id 应来自 meta.json');
    } finally {
      await second.close();
    }
  } finally {
    await first.close().catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
});

test('首次初始化数据根目录：空的 spaces/ 与默认 config.json', async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'xdoc-init-'));
  const root = path.join(base, 'fresh-root');

  const server = await startServer({ root, port: 0 });
  try {
    // 不预置示例空间；而且不带任何令牌就能列出来（默认不鉴权）
    const response = await fetch(`http://127.0.0.1:${server.port}/api/spaces`);
    assert.equal(response.status, 200, '没设令牌时不该要求鉴权');
    const spaces = (await response.json()) as SpacePayload[];
    assert.deepEqual(spaces, [], '新 root 不植入任何示例空间');

    assert.ok(existsSync(path.join(root, 'index.json')));
    assert.ok(existsSync(path.join(root, 'spaces')));

    // 默认配置：监听 0.0.0.0、不设令牌，0600
    const configFile = path.join(root, 'config.json');
    const settings = JSON.parse(await readFile(configFile, 'utf8')) as { host?: string; token?: string };
    assert.equal(settings.host, '0.0.0.0');
    assert.equal(settings.token, undefined);
    assert.equal((await stat(configFile)).mode & 0o777, 0o600);
  } finally {
    await server.close();
    await rm(base, { recursive: true, force: true });
  }
});

test('index.json 的 order 决定空间顺序', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'xdoc-order-'));
  await makeSpace(root, 'alpha', { 'index.md': '# A' });
  await makeSpace(root, 'beta', { 'index.md': '# B' });
  await makeSpace(root, 'gamma', { 'index.md': '# C' });

  // 索引缺失时按目录名排序
  const first = await startServer({ root, port: 0 });
  try {
    const spaces = (await (await fetch(`http://127.0.0.1:${first.port}/api/spaces`)).json()) as SpacePayload[];
    assert.deepEqual(spaces.map((space) => space.name), ['alpha', 'beta', 'gamma']);
    assert.deepEqual((await readIndex(root)).order, ['alpha', 'beta', 'gamma']);
  } finally {
    await first.close();
  }

  await writeFile(
    path.join(root, 'index.json'),
    JSON.stringify({ version: 1, order: ['gamma', 'alpha', 'beta'] }, null, 2),
  );

  const second = await startServer({ root, port: 0 });
  try {
    const spaces = (await (await fetch(`http://127.0.0.1:${second.port}/api/spaces`)).json()) as SpacePayload[];
    assert.deepEqual(spaces.map((space) => space.name), ['gamma', 'alpha', 'beta']);
  } finally {
    await second.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('旧式平铺目录自动迁移进 doc/', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'xdoc-migrate-'));
  const dir = spaceDir(root, 'flat');
  await makeFlatSpace(root, 'flat', {
    'index.md': '# 旧文档\n\n![图](logo.png)',
    'guide/intro.md': '# 嵌套文档',
    'logo.png': 'fake-png',
    'xdoc.config.ts': 'export default function setup() {}\n',
  });

  const first = await startServer({ root, port: 0 });
  let originalId: string;
  try {
    const spaces = (await (await fetch(`http://127.0.0.1:${first.port}/api/spaces`)).json()) as SpacePayload[];
    assert.equal(spaces.length, 1);
    originalId = spaces[0].id;

    // 文档与资源都迁移进 doc/，嵌套结构保留
    assert.ok(existsSync(path.join(dir, 'doc', 'index.md')));
    assert.ok(existsSync(path.join(dir, 'doc', 'guide', 'intro.md')));
    assert.ok(existsSync(path.join(dir, 'doc', 'logo.png')), '图片应随文档一起迁移');
    assert.ok(!existsSync(path.join(dir, 'index.md')), '空间根下不应再有文档');

    // 配置与 meta.json 留在空间根
    assert.ok(existsSync(path.join(dir, 'xdoc.config.ts')), 'xdoc.config.ts 应留在空间根');
    assert.ok(existsSync(path.join(dir, 'meta.json')));

    // 目录树基于 doc/
    const tree = (await (
      await fetch(`http://127.0.0.1:${first.port}/api/tree?space=${originalId}`)
    ).json()) as Array<{ path: string }>;
    assert.deepEqual(
      tree.map((node) => node.path).sort(),
      ['guide', 'index.md'],
    );
  } finally {
    await first.close();
  }

  // 二次启动：不再迁移，id 保持不变
  const second = await startServer({ root, port: 0 });
  try {
    const spaces = (await (await fetch(`http://127.0.0.1:${second.port}/api/spaces`)).json()) as SpacePayload[];
    assert.equal(spaces[0].id, originalId, '重启后 id 应保持不变');
    assert.ok(!existsSync(path.join(dir, 'doc', 'doc')), '不应发生二次迁移');
  } finally {
    await second.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('空间目录整体移动后 id 不变', async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'xdoc-move-'));
  const rootA = path.join(base, 'root-a');
  const rootB = path.join(base, 'root-b');
  await makeSpace(rootA, 'before', { 'index.md': '# 文档' });

  const first = await startServer({ root: rootA, port: 0 });
  let originalId: string;
  try {
    const spaces = (await (await fetch(`http://127.0.0.1:${first.port}/api/spaces`)).json()) as SpacePayload[];
    originalId = spaces[0].id;
  } finally {
    await first.close();
  }

  // 整个空间目录搬到另一个 root 下并改名
  await mkdir(path.join(rootB, 'spaces'), { recursive: true });
  await rm(path.join(rootB, 'spaces', 'after'), { recursive: true, force: true });
  await rename(spaceDir(rootA, 'before'), spaceDir(rootB, 'after'));

  const second = await startServer({ root: rootB, port: 0 });
  try {
    const spaces = (await (await fetch(`http://127.0.0.1:${second.port}/api/spaces`)).json()) as SpacePayload[];
    assert.equal(spaces.length, 1);
    assert.equal(spaces[0].id, originalId, '目录改名后 id 应来自 meta.json 保持不变');
  } finally {
    await second.close();
    await rm(base, { recursive: true, force: true });
  }
});

test('访问令牌：数据接口要令牌，静态资源不要', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'xdoc-token-'));
  await makeSpace(root, 'docs', { 'index.md': '# 文档' });

  const token = 'unit-test-token';
  const server = await startServer({ root, port: 0, token });
  const api = (route: string, init?: RequestInit) => fetch(`http://127.0.0.1:${server.port}${route}`, init);
  const bearer = { Authorization: `Bearer ${token}` };

  try {
    // 没令牌 / 令牌不对
    const anonymous = await api('/api/spaces');
    assert.equal(anonymous.status, 401);
    assert.equal(anonymous.headers.get('www-authenticate'), 'Bearer');

    const wrong = await api('/api/spaces', { headers: { Authorization: 'Bearer nope' } });
    assert.equal(wrong.status, 401, '令牌不对也应当 401');

    // 两种带令牌的方式都认：请求头，以及给 <img> / EventSource 用的查询串
    assert.equal((await api('/api/spaces', { headers: bearer })).status, 200);
    assert.equal((await api(`/api/spaces?token=${token}`)).status, 200);

    // 静态资源必须放行，否则页面本身都打不开，也就没法让用户输入令牌
    assert.equal((await api('/')).status, 200);
    assert.equal((await api('/app.js')).status, 200);

    // 写接口同样受保护，且没令牌时不得落盘
    const docRoot = path.join(spaceDir(root, 'docs'), 'doc');
    const blocked = await api('/api/file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ space: 'docs', path: 'hacked.md' }),
    });
    assert.equal(blocked.status, 401);
    assert.ok(!existsSync(path.join(docRoot, 'hacked.md')), '未授权的写入不应生效');
  } finally {
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('MCP over HTTP：initialize / tools / 通知 / 方法限制 / Origin 校验', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'xdoc-mcp-http-'));
  await makeSpace(root, 'docs', { 'index.md': '# 文档' });

  const token = 'mcp-token';
  const server = await startServer({ root, port: 0, token });
  const base = `http://127.0.0.1:${server.port}`;
  const rpc = (body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...headers },
      body: JSON.stringify(body),
    });

  try {
    // 没令牌进不来
    const anonymous = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    assert.equal(anonymous.status, 401);

    // initialize：协议版本按客户端给的回
    const init = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } });
    assert.equal(init.status, 200);
    const initBody = (await init.json()) as { result: { protocolVersion: string; capabilities: { tools: object } } };
    assert.equal(initBody.result.protocolVersion, '2024-11-05');
    assert.ok(initBody.result.capabilities.tools);

    // 工具列表：至少要能读写文档
    const list = (await (await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).json()) as {
      result: { tools: { name: string }[] };
    };
    const names = list.result.tools.map((tool) => tool.name);
    for (const expected of ['list_spaces', 'read_doc', 'write_doc', 'search_docs']) {
      assert.ok(names.includes(expected), `工具列表应包含 ${expected}`);
    }

    // 纯通知：按规范回 202，且不带消息体
    const notify = await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' });
    assert.equal(notify.status, 202);
    assert.equal(await notify.text(), '');

    // 批量消息：按数组回
    const batch = await rpc([
      { jsonrpc: '2.0', id: 3, method: 'ping' },
      { jsonrpc: '2.0', id: 4, method: 'tools/list' },
    ]);
    const batchBody = (await batch.json()) as { id: number }[];
    assert.ok(Array.isArray(batchBody));
    assert.deepEqual(
      batchBody.map((item) => item.id),
      [3, 4],
    );

    // 只接受 SSE 的客户端：按事件流回一条 message
    const sse = await rpc(
      { jsonrpc: '2.0', id: 5, method: 'ping' },
      { Accept: 'text/event-stream' },
    );
    assert.equal(sse.status, 200);
    assert.match(sse.headers.get('content-type') ?? '', /text\/event-stream/);
    assert.match(await sse.text(), /^event: message\ndata: /);

    // 端点只收 POST
    const get = await fetch(`${base}/mcp`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(get.status, 405);
    assert.equal(get.headers.get('allow'), 'POST');

    // Origin 与 Host 不一致 = 浏览器页面在跨站打这个端点（DNS rebinding），挡掉
    assert.equal((await rpc({ jsonrpc: '2.0', id: 6, method: 'ping' }, { Origin: 'http://evil.example' })).status, 403);
    const sameOrigin = await rpc({ jsonrpc: '2.0', id: 7, method: 'ping' }, { Origin: base });
    assert.equal(sameOrigin.status, 200);

    // 真的写一个文档进去：远端 Agent 写的东西，本地目录里要能看见
    const write = await rpc({
      jsonrpc: '2.0',
      id: 8,
      method: 'tools/call',
      params: { name: 'write_doc', arguments: { path: 'remote/from-mcp.md', content: '# 来自 MCP\n\n:::tip 提示\n写进去了\n:::' } },
    });
    const writeBody = (await write.json()) as { result: { isError: boolean } };
    assert.equal(writeBody.result.isError, false);
    const written = await readFile(path.join(spaceDir(root, 'docs'), 'doc', 'remote', 'from-mcp.md'), 'utf8');
    assert.match(written, /来自 MCP/);

    // 网页端的接口立刻能看到这份文档（MCP 与 HTTP 共用同一份空间运行时）。
    // /api/tree 返回的是嵌套目录树，写个展开函数把它压平
    const spaces = (await (
      await fetch(`${base}/api/spaces`, { headers: { Authorization: `Bearer ${token}` } })
    ).json()) as SpacePayload[];
    const tree = (await (
      await fetch(`${base}/api/tree?space=${spaces[0].id}`, { headers: { Authorization: `Bearer ${token}` } })
    ).json()) as { path: string; children?: unknown[] }[];
    const flatten = (nodes: { path: string; children?: unknown[] }[]): string[] =>
      nodes.flatMap((node) => [node.path, ...flatten((node.children ?? []) as { path: string }[])]);
    assert.ok(
      flatten(tree).includes('remote/from-mcp.md'),
      'MCP 写入的文档应出现在网页端的目录树里',
    );
  } finally {
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('HTTPS：给了证书就用 https 提供服务', { skip: !hasOpenssl && '未安装 openssl，跳过' }, async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'xdoc-tls-'));
  const root = path.join(dir, 'root');
  await makeSpace(root, 'docs', { 'index.md': '# 文档' });
  const certFile = path.join(dir, 'cert.pem');
  const keyFile = path.join(dir, 'key.pem');

  const generated = spawnSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', keyFile, '-out', certFile,
    '-days', '1', '-subj', '/CN=localhost',
  ]);
  assert.equal(generated.status, 0, '生成自签证书失败');

  const server = await startServer({
    root,
    port: 0,
    token: 'tls-token',
    tls: { cert: await readFile(certFile), key: await readFile(keyFile) },
  });

  // 自签证书过不了 fetch 的校验，这里直接用 https 模块并在选项里关掉校验
  const get = (route: string): Promise<{ status: number; body: string }> =>
    new Promise((resolve, reject) => {
      const req = httpsRequest(
        {
          host: '127.0.0.1',
          port: server.port,
          path: route,
          rejectUnauthorized: false,
          headers: { Authorization: 'Bearer tls-token' },
        },
        (res) => {
          let body = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => (body += chunk));
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
        },
      );
      req.on('error', reject);
      req.end();
    });

  try {
    assert.match(server.url, /^https:/);
    const spaces = await get('/api/spaces');
    assert.equal(spaces.status, 200);
    assert.match(spaces.body, /docs/);

    // 同一端口上明文 http 应当连不上：没退回 http
    const plain = await fetch(`http://127.0.0.1:${server.port}/api/spaces`, { headers: { Authorization: 'Bearer tls-token' } })
      .then(() => 'ok')
      .catch(() => 'failed');
    assert.equal(plain, 'failed');
  } finally {
    await server.close();
    await rm(dir, { recursive: true, force: true });
  }
});
