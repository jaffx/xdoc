import path from 'node:path';
import { legacyRegistryHint, loadIndex, saveIndex } from './persistence';
import { ensureRoot, listSpaceSlugs, spacesDirOf } from './root';
import type { SpaceManager } from './space';

/**
 * 从数据根目录加载空间：
 * 1. 准备 root（首次初始化时植入内置模板）
 * 2. 扫描 <root>/spaces 下的子目录，按 index.json 的 order 排序
 * 3. 逐个装载；缺 doc/ 或仍是平铺结构的目录由 ensureSpaceDir 自动补齐
 */
export async function bootstrapSpaces(
  manager: SpaceManager,
  root: string,
  log: (message: string) => void = () => {},
): Promise<void> {
  const { seeded } = await ensureRoot(root);
  for (const slug of seeded) log(`已植入内置示例空间：${slug}`);

  for (const dir of legacyRegistryHint(root)) {
    log(`旧版注册表中的空间未被接管：${dir}`);
    log(`  如需继续使用，请执行：mv ${JSON.stringify(dir)} ${JSON.stringify(path.join(spacesDirOf(root), path.basename(dir)))}`);
  }

  const index = loadIndex(root);
  const slugs = await listSpaceSlugs(root);
  const rank = new Map(index.order.map((slug, position) => [slug, position]));
  // 索引里没有的空间（外部直接丢进来的目录）排在后面，listSpaceSlugs 已按名称排序
  slugs.sort((a, b) => (rank.get(a) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b) ?? Number.MAX_SAFE_INTEGER));

  const loaded: string[] = [];
  for (const slug of slugs) {
    const dir = path.join(spacesDirOf(root), slug);
    try {
      const { space, migrated, initialized } = await manager.add({ dir });
      loaded.push(slug);
      log(`空间「${space.name}」${initialized ? '（已初始化）' : ''}`);
      if (migrated > 0) log(`已把 ${migrated} 个条目迁移进 ${path.join(slug, 'doc')}/`);
    } catch (error) {
      log(`加载空间失败：${slug}（${error instanceof Error ? error.message : error}）`);
    }
  }

  saveIndex(root, { ...index, order: loaded });
}
