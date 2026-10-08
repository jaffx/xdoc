import { existsSync } from 'node:fs';
import path from 'node:path';
import { loadPersistedSpaces } from './persistence';
import type { SpaceManager } from './space';

/**
 * 初始化空间：
 * 1. CLI 指定的目录（应用注册表中的元数据）
 * 2. 注册表中已保存、且未被 CLI 覆盖的空间
 */
export async function bootstrapSpaces(
  manager: SpaceManager,
  roots: string[],
  log: (message: string) => void = () => {},
): Promise<void> {
  const registry = new Map(loadPersistedSpaces().map((entry) => [path.resolve(entry.root), entry]));

  for (const root of roots) {
    const resolved = path.resolve(root);
    const entry = registry.get(resolved);
    const { space } = await manager.add({
      root: resolved,
      source: 'cli',
      name: entry?.name,
      description: entry?.description,
      createdAt: entry?.createdAt,
      updatedAt: entry?.updatedAt,
      tracked: entry !== undefined,
    });
    log(`空间「${space.name}」-> ${space.root}`);
  }

  for (const entry of registry.values()) {
    if (manager.hasRoot(entry.root)) continue;
    if (!existsSync(entry.root)) {
      log(`跳过已失效的空间：${entry.root}`);
      continue;
    }
    try {
      const { space } = await manager.add({
        root: entry.root,
        name: entry.name,
        description: entry.description,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
        source: 'user',
        tracked: true,
      });
      log(`恢复空间「${space.name}」-> ${space.root}`);
    } catch (error) {
      log(`恢复空间失败：${entry.root}（${error instanceof Error ? error.message : error}）`);
    }
  }
}