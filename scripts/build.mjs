import { build, context } from 'esbuild';
import { chmod, cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

const watch = process.argv.includes('--watch');

const serverOptions = {
  entryPoints: ['src/cli.ts'],
  outfile: 'dist/cli.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node18',
  packages: 'external',
  banner: { js: '#!/usr/bin/env node' },
  sourcemap: true,
  logLevel: 'info',
};

const clientOptions = {
  entryPoints: ['src/client/main.ts'],
  outfile: 'dist/public/app.js',
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: ['es2020'],
  sourcemap: true,
  logLevel: 'info',
};

/**
 * echarts 体积大，打成全局变量挂载的独立 bundle，
 * client/diagram.ts 只在文档里出现 echarts 嵌入体时才注入 <script>。
 */
const vendorOptions = [
  {
    entryPoints: ['src/client/vendor/echarts.ts'],
    outfile: 'dist/public/vendor/echarts.js',
    bundle: true,
    platform: 'browser',
    format: 'iife',
    globalName: 'xdocEcharts',
    target: ['es2020'],
    minify: true,
    logLevel: 'info',
    footer: { js: 'window.echarts=xdocEcharts;' },
  },
];

/**
 * mermaid 不打包：官方 esm.min 产物本身就把各图类型拆成懒加载分块，
 * 打包反而会把 100 多个分块全部内联成一个 5MB 的 bundle。
 * 这里按原目录结构拷贝，浏览器端用 import() 加载，只拉取用到的图类型。
 */
async function copyMermaid() {
  const from = 'node_modules/mermaid/dist';
  const to = 'dist/public/vendor/mermaid';
  await mkdir(path.join(to, 'chunks'), { recursive: true });
  await cp(path.join(from, 'mermaid.esm.min.mjs'), path.join(to, 'mermaid.esm.min.mjs'));
  // 只拷 .mjs，跳过 sourcemap
  await cp(path.join(from, 'chunks/mermaid.esm.min'), path.join(to, 'chunks/mermaid.esm.min'), {
    recursive: true,
    filter: (src) => !src.endsWith('.map'),
  });
}

await rm('dist', { recursive: true, force: true });
await mkdir('dist/public', { recursive: true });
await cp('public', 'dist/public', { recursive: true });

if (watch) {
  // vendor 资源只依赖 node_modules，构建一次即可，不进 watch
  await copyMermaid();
  await Promise.all(vendorOptions.map((options) => build(options)));
  const [serverCtx, clientCtx] = await Promise.all([
    context(serverOptions),
    context(clientOptions),
  ]);
  await Promise.all([serverCtx.watch(), clientCtx.watch()]);
  console.log('[xdoc] watch 模式已启动，修改 src 后会自动重建');
} else {
  await Promise.all([
    build(serverOptions),
    build(clientOptions),
    ...vendorOptions.map((o) => build(o)),
    copyMermaid(),
  ]);
  await chmod('dist/cli.js', 0o755);
}