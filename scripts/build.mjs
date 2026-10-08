import { build, context } from 'esbuild';
import { chmod, cp, mkdir, rm } from 'node:fs/promises';

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

await rm('dist', { recursive: true, force: true });
await mkdir('dist/public', { recursive: true });
await cp('public', 'dist/public', { recursive: true });

if (watch) {
  const [serverCtx, clientCtx] = await Promise.all([
    context(serverOptions),
    context(clientOptions),
  ]);
  await Promise.all([serverCtx.watch(), clientCtx.watch()]);
  console.log('[xdoc] watch 模式已启动，修改 src 后会自动重建');
} else {
  await Promise.all([build(serverOptions), build(clientOptions)]);
  await chmod('dist/cli.js', 0o755);
}