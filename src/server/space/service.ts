import { existsSync, statSync } from 'node:fs';
import { mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { slugify, spacesDirOf, trashDirOf, uniqueSlug } from '../kernel/root';
import { docRootOf, ensureSpaceDir, generateSpaceId, loadIndex, saveIndex, writeMeta, type SpaceMetaSeed } from './dao';
import { MgrSpaceRuntime, type EmitFn } from './manager';
import type { AddSpaceInput, AddSpaceResult, CreateSpaceInput, PublicSpaceInfo, SpaceInfo } from './types';
import { InvalidInputError } from '../kernel/errors';
/**
 * 空间模块对外的能力面。
 *
 * SrvcSpaces 是唯一的入口：装载 <root>/spaces 下的空间、建空间、移除空间。
 * 其它模块要拿到某个空间，只能走这里的 get()，拿到的是 manager 造的运行时把手。
 */

export type { AddSpaceInput, AddSpaceResult, CreateSpaceInput, PublicSpaceInfo, SpaceInfo } from './types';
export type { MgrSpaceRuntime } from './manager';

/**
 * 把空间顺序与活跃空间落到 <root>/index.json。
 * 组装点与 MCP 端点共用这一份，免得两处各写一遍。
 */
export function persistSpaceIndex(root: string, spaces: SrvcSpaces, lastActiveSpace?: string): void {
  const index = loadIndex(root);
  saveIndex(root, {
    ...index,
    order: spaces.order(),
    lastActiveSpace: lastActiveSpace ?? index.lastActiveSpace,
  });
}

/** 呈现给浏览器之前剥掉 dir / docRoot / slug，避免宿主机路径泄露到前端 */
export function publicSpace(info: SpaceInfo): PublicSpaceInfo {
  const result: PublicSpaceInfo = { id: info.id, name: info.name };
  if (info.description) result.description = info.description;
  if (info.createdAt !== undefined) result.createdAt = info.createdAt;
  if (info.updatedAt !== undefined) result.updatedAt = info.updatedAt;
  return result;
}

export class SrvcSpaces {
  private readonly runtimes = new Map<string, MgrSpaceRuntime>();

  constructor(
    readonly root: string,
    private readonly emit: EmitFn,
    private readonly options: { watch?: boolean } = {},
  ) {}

  list(): SpaceInfo[] {
    return [...this.runtimes.values()].map((runtime) => runtime.info);
  }

  get(id: string): MgrSpaceRuntime | undefined {
    return this.runtimes.get(id);
  }

  default(): MgrSpaceRuntime | undefined {
    return this.runtimes.values().next().value;
  }

  hasDir(dir: string): boolean {
    const target = path.resolve(dir);
    return this.list().some((space) => space.dir === target);
  }

  /** 当前空间的展示顺序（目录名），写入 index.json */
  order(): string[] {
    return this.list().map((space) => space.slug);
  }

  /** 装载 <root>/spaces 下已存在的空间目录 */
  async add(input: AddSpaceInput): Promise<AddSpaceResult> {
    const dir = path.resolve(input.dir);
    if (existsSync(dir) && !statSync(dir).isDirectory()) throw new InvalidInputError(`不是目录：${dir}`);

    const existing = this.list().find((space) => space.dir === dir);
    if (existing) {
      return { space: this.runtimes.get(existing.id)!.info, created: false, migrated: 0, initialized: false };
    }

    const { meta, migrated, initialized } = await ensureSpaceDir(dir, input.seed ?? {});

    // 直接拷贝空间目录会带来重复 id，重新生成并回写
    let id = meta.id;
    if (this.runtimes.has(id)) {
      id = generateSpaceId();
      await writeMeta(dir, { ...meta, id });
    }

    const runtime = new MgrSpaceRuntime(
      {
        id,
        name: this.uniqueName(meta.name),
        slug: path.basename(dir),
        dir,
        docRoot: docRootOf(dir),
        description: meta.description,
        createdAt: meta.createdAt,
        updatedAt: meta.updatedAt,
      },
      this.emit,
      this.options.watch !== false,
    );
    await runtime.init();
    this.runtimes.set(id, runtime);
    return { space: runtime.info, created: true, migrated, initialized };
  }

  /** 按名称在 <root>/spaces 下新建空间，目录名由名称派生 */
  async create(input: CreateSpaceInput): Promise<AddSpaceResult> {
    const name = input.name.trim();
    if (!name) throw new InvalidInputError('空间名称不能为空');

    const spacesDir = spacesDirOf(this.root);
    await mkdir(spacesDir, { recursive: true });
    const slug = uniqueSlug(spacesDir, slugify(name));

    const seed: SpaceMetaSeed = { name };
    if (input.description?.trim()) seed.description = input.description.trim();
    return this.add({ dir: path.join(spacesDir, slug), seed });
  }

  /**
   * 移除空间：空间目录移入 <root>/trash/，而不是从磁盘删掉。
   * 空间现在是扫描 <root>/spaces 发现的，若只摘掉运行时，下次启动会原样回来。
   */
  async remove(id: string): Promise<string | null> {
    const runtime = this.runtimes.get(id);
    if (!runtime) return null;
    this.runtimes.delete(id);
    await runtime.close();

    const trashDir = trashDirOf(this.root);
    await mkdir(trashDir, { recursive: true });
    const target = path.join(trashDir, `${runtime.info.slug}-${Date.now()}`);
    await rename(runtime.info.dir, target);
    return target;
  }

  async closeAll(): Promise<void> {
    const runtimes = [...this.runtimes.values()];
    this.runtimes.clear();
    await Promise.all(runtimes.map((runtime) => runtime.close()));
  }

  /** 展示名去重，仅作用于内存，不回写 meta.json */
  private uniqueName(candidate: string): string {
    const taken = new Set(this.list().map((space) => space.name));
    if (!taken.has(candidate)) return candidate;
    let index = 2;
    while (taken.has(`${candidate} ${index}`)) index++;
    return `${candidate} ${index}`;
  }
}
