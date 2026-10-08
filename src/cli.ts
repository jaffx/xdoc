import { exec } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { startServer } from './server/index';
import { ensureRoot, loadSettings, resolveRoot } from './server/root';

const HELP = `
xdoc - 支持空间与自定义嵌入体语法的 Markdown 文档浏览工具

用法：
  xdoc [数据根目录] [选项]     启动本地文档站点
  xdoc mcp [数据根目录]        启动 MCP stdio 服务（供 Agent 调用）

所有空间都保存在数据根目录下：

  <root>/
  ├── index.json      # 空间索引
  ├── config.json     # 部署参数（token / host / port / cert / key），首次运行自动生成
  └── spaces/<空间>/  # meta.json + xdoc.config.ts + doc/

不传数据根目录时使用 ~/.xdoc，也可用 XDOC_ROOT 环境变量指定。
空间在网页左上角切换、新建与移除，无需在命令行指定。

选项（优先级：命令行 > 环境变量 > <root>/config.json）：
      --root <路径>   数据根目录（等价于位置参数）
  -p, --port <端口>   监听端口（默认 1998，被占用时自动 +1 重试）
      --host <地址>   监听地址（默认 127.0.0.1）
      --token <令牌>  访问令牌，等价于 XDOC_TOKEN
      --cert <路径>   TLS 证书（PEM），与 --key 一起用则提供 https
      --key <路径>    TLS 私钥（PEM）
      --allow-anonymous
                      监听非本机地址时不设令牌（默认拒绝启动）
      --no-open       不自动打开浏览器
  -h, --help          显示帮助
  -v, --version       显示版本

远程部署：把文档服务挂到服务器上，本地 Agent 通过 HTTP 调用 MCP。

  在 <root>/config.json 里写好部署参数，之后启动就不用带任何选项：

    { "host": "0.0.0.0", "token": "自己定一个足够长的随机串" }

  MCP 端点是 http://<服务器>:1998/mcp，客户端带 Authorization: Bearer <令牌>。
  令牌走的是明文 HTTP，只适合内网、VPN 或 SSH 隧道；要过公网请在 config.json
  里配 cert / key 启用 https（或把 xdoc 挂在带证书的反向代理后面）。

MCP 示例（Agent 配置，本地 stdio）：
  { "command": "npx", "args": ["xdoc", "mcp"] }
`;

/** 监听地址是不是只对本机可见 */
function isLoopback(host: string): boolean {
  return host === 'localhost' || host === '::1' || host === '[::1]' || host.startsWith('127.');
}

function openBrowser(url: string) {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start ""' : 'xdg-open';
  exec(`${command} ${JSON.stringify(url)}`, (error) => {
    if (error) console.log('[xdoc] 未能自动打开浏览器，请手动访问上方地址');
  });
}

async function main() {
  const { values, positionals } = parseArgs({
    options: {
      root: { type: 'string' },
      port: { type: 'string', short: 'p' },
      host: { type: 'string' },
      token: { type: 'string' },
      cert: { type: 'string' },
      key: { type: 'string' },
      'allow-anonymous': { type: 'boolean', default: false },
      open: { type: 'boolean', default: true },
      'no-open': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log(HELP.trim());
    return;
  }
  if (values.version) {
    console.log('xdoc 0.1.0');
    return;
  }

  const isMcp = positionals[0] === 'mcp';
  const rest = isMcp ? positionals.slice(1) : positionals;

  // 早期版本是 `xdoc 目录1 目录2`，现在只接受单个数据根目录，明确报错而不是静默忽略
  if (rest.length > 1) {
    console.error('只能指定一个数据根目录，空间请在网页中新建。');
    console.error(`收到：${rest.join(' ')}`);
    process.exit(1);
  }

  const root = resolveRoot(values.root ?? rest[0]);

  // 先备好数据根目录：这样首次运行就有 config.json 可填，
  // 下面提到它的报错信息才不会是"让你去改一个不存在的文件"
  await ensureRoot(root);

  if (isMcp) {
    const { runMcpStdio } = await import('./mcp/server');
    await runMcpStdio({ root });
    return;
  }

  const port = values.port ? Number.parseInt(values.port, 10) : undefined;
  if (values.port && (!Number.isInteger(port) || (port as number) <= 0)) {
    console.error(`端口非法：${values.port}`);
    process.exit(1);
  }

  // 命令行 > 环境变量 > <root>/config.json
  const settings = loadSettings(root);
  const host = values.host ?? settings.host ?? '127.0.0.1';
  const token = values.token ?? process.env.XDOC_TOKEN ?? settings.token ?? '';
  const certPath = values.cert ?? settings.cert;
  const keyPath = values.key ?? settings.key;

  if (Boolean(certPath) !== Boolean(keyPath)) {
    console.error('cert 与 key 必须同时提供（--cert/--key 或 config.json 里的 cert/key）。');
    process.exit(1);
  }
  let tls: { cert: Buffer; key: Buffer } | undefined;
  if (certPath && keyPath) {
    try {
      tls = { cert: readFileSync(certPath), key: readFileSync(keyPath) };
    } catch (error) {
      console.error(`读取证书失败：${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  }

  // 监听非本机地址等于把读写删文档的接口放出去，没有令牌就直接拦下来，
  // 免得一个手滑变成谁都能改你文档的公开服务
  if (!isLoopback(host) && !token && !values['allow-anonymous']) {
    console.error(`拒绝启动： --host ${host} 会对外提供服务，但没有设置访问令牌。`);
    console.error(`请在 ${path.join(root, 'config.json')} 里写一个令牌，例如：`);
    console.error('  { "host": "0.0.0.0", "token": "自己定一个足够长的随机串" }');
    console.error('也可以用 --token <令牌> 或环境变量 XDOC_TOKEN 临时指定。');
    console.error('确实不需要认证（如已在可信内网）就加 --allow-anonymous。');
    process.exit(1);
  }
  if (token && !tls) {
    console.error('[xdoc] 提醒：令牌走的是明文 HTTP，只适合内网、VPN 或 SSH 隧道；');
    console.error('[xdoc]       需要过公网请配 --cert / --key 启用 https。');
  }

  const running = await startServer({ root, port, host, token: token || undefined, tls });
  console.log('');
  console.log(`  xdoc 已启动 -> ${running.url}`);
  if (token) {
    console.log(`  访问令牌已启用，MCP 端点 ${running.url}/mcp（Authorization: Bearer <令牌>）`);
  }
  console.log('  按 Ctrl+C 停止');
  console.log('');

  if (values.open && !values['no-open']) openBrowser(running.url);

  const shutdown = async () => {
    await running.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

main().catch((error) => {
  console.error(`[xdoc] 启动失败：${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});