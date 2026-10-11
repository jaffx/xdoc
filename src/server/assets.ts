import { existsSync } from 'node:fs';
import { mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { OperationError, assertRelPath, resolveInside } from './operations';

const ASSETS_DIR = 'assets';

export interface AssetInfo {
  path: string;
  name: string;
  size: number;
  mimeType: string;
  mtime: number;
}

export interface AssetManager {
  assetsDir: string;
  list(dir?: string): Promise<AssetInfo[]>;
  upload(file: Buffer, filename: string, targetPath?: string): Promise<AssetInfo>;
  delete(relPath: string): Promise<void>;
  rename(from: string, to: string): Promise<string>;
  resolve(relPath: string): string;
}

const MIME_TYPES: Record<string, string> = {
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

function getMimeType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  return MIME_TYPES[ext] ?? 'application/octet-stream';
}

function isAllowedExtension(filename: string): boolean {
  const ext = path.extname(filename).toLowerCase();
  return ext in MIME_TYPES;
}

function getSubdirByType(mimeType: string): string {
  if (mimeType.startsWith('image/')) return 'images';
  if (mimeType.startsWith('video/')) return 'videos';
  if (mimeType.startsWith('audio/')) return 'audio';
  return 'other';
}

export function createAssetManager(spaceDir: string): AssetManager {
  const assetsDir = path.join(spaceDir, ASSETS_DIR);

  async function ensureAssetsDir(): Promise<void> {
    if (!existsSync(assetsDir)) {
      await mkdir(assetsDir, { recursive: true });
    }
  }

  async function list(dir?: string): Promise<AssetInfo[]> {
    await ensureAssetsDir();
    const targetDir = dir ? resolveInside(assetsDir, dir) : assetsDir;
    if (!existsSync(targetDir)) return [];

    const items: AssetInfo[] = [];
    const entries = await readdir(targetDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const fullPath = path.join(targetDir, entry.name);
      const relPath = path.relative(assetsDir, fullPath).split(path.sep).join('/');

      if (entry.isDirectory()) {
        const subItems = await list(relPath);
        items.push(...subItems);
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

  async function upload(file: Buffer, filename: string, targetPath?: string): Promise<AssetInfo> {
    if (!isAllowedExtension(filename)) {
      throw new OperationError(`不支持的文件类型：${filename}`, 400);
    }

    await ensureAssetsDir();

    let relPath: string;
    if (targetPath) {
      relPath = assertRelPath(targetPath);
    } else {
      const mimeType = getMimeType(filename);
      const subdir = getSubdirByType(mimeType);
      const date = new Date().toISOString().slice(0, 10);
      const ext = path.extname(filename);
      const baseName = path.basename(filename, ext);
      relPath = `${subdir}/${date}-${baseName}${ext}`;
    }

    const absolute = resolveInside(assetsDir, relPath);

    if (existsSync(absolute)) {
      throw new OperationError(`文件已存在：${relPath}`, 409);
    }

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

  async function deleteAsset(relPath: string): Promise<void> {
    const absolute = resolveInside(assetsDir, relPath);
    if (!existsSync(absolute)) {
      throw new OperationError(`素材不存在：${relPath}`, 404);
    }

    const stats = await stat(absolute);
    if (stats.isDirectory()) {
      await rm(absolute, { recursive: true, force: true });
    } else {
      await rm(absolute);
    }
  }

  async function renameAsset(from: string, to: string): Promise<string> {
    const fromAbsolute = resolveInside(assetsDir, from);
    if (!existsSync(fromAbsolute)) {
      throw new OperationError(`素材不存在：${from}`, 404);
    }

    const toAbsolute = resolveInside(assetsDir, to);
    if (existsSync(toAbsolute)) {
      throw new OperationError(`目标已存在：${to}`, 409);
    }

    await mkdir(path.dirname(toAbsolute), { recursive: true });
    await rename(fromAbsolute, toAbsolute);

    return to;
  }

  function resolve(relPath: string): string {
    return resolveInside(assetsDir, relPath);
  }

  return {
    assetsDir,
    list,
    upload,
    delete: deleteAsset,
    rename: renameAsset,
    resolve,
  };
}
