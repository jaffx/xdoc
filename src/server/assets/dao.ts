import { existsSync } from 'node:fs';
import { mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { resolveInside } from '../kernel/paths';
import { ConflictError, NotFoundError } from '../kernel/errors';
/** 素材库在空间目录下的固定子目录名 */
export const ASSETS_DIR = 'assets';

export const MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
};

export function getMimeType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  return MIME_TYPES[ext] ?? 'application/octet-stream';
}

/** 一条素材在库内的位置与元信息 */
export interface AssetRecord {
  path: string;
  name: string;
  size: number;
  mimeType: string;
  mtime: number;
}

/**
 * 素材库的存储能力：只认「库根目录 + 相对路径」，不判断该不该存。
 * 类型白名单、落哪个子目录这类取舍在 ../assets/service 里。
 */
export function createAssetStore(assetsDir: string) {
  async function ensureDir(): Promise<void> {
    if (!existsSync(assetsDir)) await mkdir(assetsDir, { recursive: true });
  }

  async function list(dir?: string): Promise<AssetRecord[]> {
    await ensureDir();
    const targetDir = dir ? resolveInside(assetsDir, dir) : assetsDir;
    if (!existsSync(targetDir)) return [];

    const items: AssetRecord[] = [];
    const entries = await readdir(targetDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const fullPath = path.join(targetDir, entry.name);
      const relPath = path.relative(assetsDir, fullPath).split(path.sep).join('/');

      if (entry.isDirectory()) {
        items.push(...(await list(relPath)));
      } else if (entry.isFile()) {
        const stats = await stat(fullPath);
        items.push({
          path: relPath,
          name: entry.name,
          size: stats.size,
          mimeType: getMimeType(entry.name),
          mtime: stats.mtimeMs,
        });
      }
    }

    return items.sort((a, b) => a.path.localeCompare(b.path));
  }

  async function write(relPath: string, file: Buffer): Promise<AssetRecord> {
    const absolute = resolveInside(assetsDir, relPath);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, file);

    const stats = await stat(absolute);
    return {
      path: relPath,
      name: path.basename(relPath),
      size: stats.size,
      mimeType: getMimeType(relPath),
      mtime: stats.mtimeMs,
    };
  }

  async function remove(relPath: string): Promise<void> {
    const absolute = resolveInside(assetsDir, relPath);
    if (!existsSync(absolute)) throw new NotFoundError(`素材不存在：${relPath}`);

    const stats = await stat(absolute);
    if (stats.isDirectory()) {
      await rm(absolute, { recursive: true, force: true });
    } else {
      await rm(absolute);
    }
  }

  async function move(from: string, to: string): Promise<void> {
    const fromAbsolute = resolveInside(assetsDir, from);
    if (!existsSync(fromAbsolute)) throw new NotFoundError(`素材不存在：${from}`);

    const toAbsolute = resolveInside(assetsDir, to);
    if (existsSync(toAbsolute)) throw new ConflictError(`目标已存在：${to}`);

    await mkdir(path.dirname(toAbsolute), { recursive: true });
    await rename(fromAbsolute, toAbsolute);
  }

  function resolve(relPath: string): string {
    return resolveInside(assetsDir, relPath);
  }

  function exists(relPath: string): boolean {
    return existsSync(resolveInside(assetsDir, relPath));
  }

  return { assetsDir, ensureDir, list, write, remove, move, resolve, exists };
}

export type AssetStore = ReturnType<typeof createAssetStore>;
