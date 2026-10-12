import path from 'node:path';

import { assertRelPath } from '../kernel/paths';
import { ASSETS_DIR, MIME_TYPES, createAssetStore, getMimeType, type AssetRecord } from './dao';
import { ConflictError, InvalidInputError } from '../kernel/errors';
/**
 * 素材模块对外的能力面。
 *
 * 建在 dao 之上是因为两条规则不属于存储：哪些扩展名允许上传、没指定路径时落到哪个分类子目录。
 * 空间运行时（space/manager）按照 R3 只持有这里的把手，不碰 ./dao。
 */

export type AssetInfo = AssetRecord;

export interface AssetService {
  assetsDir: string;
  list(dir?: string): Promise<AssetInfo[]>;
  upload(file: Buffer, filename: string, targetPath?: string): Promise<AssetInfo>;
  delete(relPath: string): Promise<void>;
  rename(from: string, to: string): Promise<string>;
  resolve(relPath: string): string;
}

/** 决定一份素材落在哪个分类子目录 */
function subdirOf(mimeType: string): string {
  if (mimeType.startsWith('image/')) return 'images';
  if (mimeType.startsWith('video/')) return 'videos';
  if (mimeType.startsWith('audio/')) return 'audio';
  return 'other';
}

export function createAssetService(spaceDir: string): AssetService {
  const store = createAssetStore(path.join(spaceDir, ASSETS_DIR));

  async function upload(file: Buffer, filename: string, targetPath?: string): Promise<AssetInfo> {
    if (!(path.extname(filename).toLowerCase() in MIME_TYPES)) {
      throw new InvalidInputError(`不支持的文件类型：${filename}`);
    }

    await store.ensureDir();

    let relPath: string;
    if (targetPath) {
      relPath = assertRelPath(targetPath);
    } else {
      // 按类型分目录、按日期前缀，避免同名素材互相覆盖
      const date = new Date().toISOString().slice(0, 10);
      const ext = path.extname(filename);
      const baseName = path.basename(filename, ext);
      relPath = `${subdirOf(getMimeType(filename))}/${date}-${baseName}${ext}`;
    }

    if (store.exists(relPath)) throw new ConflictError(`文件已存在：${relPath}`);
    return store.write(relPath, file);
  }

  async function rename(from: string, to: string): Promise<string> {
    await store.move(from, to);
    return to;
  }

  return {
    assetsDir: store.assetsDir,
    list: store.list,
    upload,
    delete: store.remove,
    rename,
    resolve: store.resolve,
  };
}
