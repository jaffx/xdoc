import type { EmbedDefinition } from './types';

const NAME_RE = /^[A-Za-z][\w-]*$/;

/**
 * 嵌入体注册表。名称与别名都指向同一定义，
 * 渲染时 ctx.name 为实际书写的名称（便于别名区分行为）。
 */
export class EmbedRegistry {
  private readonly embeds = new Map<string, EmbedDefinition>();

  register(definition: EmbedDefinition): this {
    const { name, aliases = [] } = definition;
    if (!NAME_RE.test(name)) {
      throw new Error(`嵌入体名称非法："${name}"，需以字母开头，仅可包含字母、数字、下划线、连字符`);
    }
    for (const alias of aliases) {
      if (!NAME_RE.test(alias)) {
        throw new Error(`嵌入体别名非法："${alias}"（${name}）`);
      }
    }
    this.embeds.set(name, definition);
    for (const alias of aliases) this.embeds.set(alias, definition);
    return this;
  }

  unregister(name: string): boolean {
    const definition = this.embeds.get(name);
    if (!definition) return false;
    this.embeds.delete(definition.name);
    for (const alias of definition.aliases ?? []) this.embeds.delete(alias);
    return true;
  }

  get(name: string): EmbedDefinition | undefined {
    return this.embeds.get(name);
  }

  has(name: string): boolean {
    return this.embeds.has(name);
  }

  /** 去重后的定义列表 */
  list(): EmbedDefinition[] {
    return [...new Set(this.embeds.values())];
  }

  /** 所有可用名称（含别名） */
  names(): string[] {
    return [...this.embeds.keys()].sort();
  }
}