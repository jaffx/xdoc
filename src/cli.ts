import { exec } from 'node:child_process';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { startServer } from './server/index';

const HELP = `
xdoc - 支持空间与自定义嵌入体语法的 Markdown 文档浏览工具

用法：
  xdoc [目录...] [选项]        启动本地文档站点
  xdoc mcp [目录...]          启动 MCP stdio 服务（供 Agent 调用）

每个目录成为一个「空间」，网页左上角可切换空间。
传入多个目录即可在多个空间之间切换：

  xdoc ./docs ./notes ~/wiki

选项：
  -p, --port <端口>   监听端口（默认 3000，被占用时自动 +1 重试）
      --host <地址>   监听地址（默认 127.0.0.1）
      --no-open       不自动打开浏览器
  -h, --help          显示帮助
  -v, --version       显示版本

MCP 示例（Agent 配置）：
  { "command": "npx", "args": ["xdoc", "mcp", "./docs"] }
`;

function openBrowser(url: string) {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start ""' : 'xdg-open';
  exec(`${command} ${JSON.stringify(url)}`, (error) => {
    if (error) console.log('[xdoc] 未能自动打开浏览器，请手动访问上方地址');
  });
}

async function main() {
  const { values, positionals } = parseArgs({
    options: {
      port: { type: 'string', short: 'p' },
      host: { type: 'string' },
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

  const roots = (positionals.length > 0 ? positionals : [process.cwd()]).map((dir) => path.resolve(dir));

  if (positionals[0] === 'mcp') {
    const mcpRoots = (positionals.length > 1 ? positionals.slice(1) : [process.cwd()]).map((dir) => path.resolve(dir));
    const { runMcpStdio } = await import('./mcp/server');
    await runMcpStdio({ roots: mcpRoots });
    return;
  }

  const port = values.port ? Number.parseInt(values.port, 10) : undefined;
  if (values.port && (!Number.isInteger(port) || (port as number) <= 0)) {
    console.error(`端口非法：${values.port}`);
    process.exit(1);
  }

  const running = await startServer({ roots, port, host: values.host });
  console.log('');
  console.log(`  xdoc 已启动 -> ${running.url}`);
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