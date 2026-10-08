/**
 * 嵌入体（Embed）定义与渲染上下文。
 *
 * 嵌入体 = 自定义块级语法 + 渲染逻辑：
 *
 *   :::name key=value 位置参数
 *   块内原始内容，支持嵌套 markdown / 其他嵌入体
 *   :::
 */
export interface EmbedRenderContext {
  /** 实际命中的名称（可能是别名），如 :::warning 的 name 为 warning */
  name: string;
  /** :::name 之后的原始参数串 */
  params: string;
  /** key=value（支持引号）解析出的属性 */
  attrs: Record<string, string>;
  /** 非 key=value 形式的位置参数 */
  positional: string[];
  /** 块内原始 markdown 内容（未渲染） */
  content: string;
  /** 渲染环境，可在自定义嵌入体之间传递数据 */
  env: Record<string, unknown>;
  /** 将 markdown 渲染为 HTML（会递归解析嵌入体） */
  render: (markdown: string) => string;
  /** 仅渲染行内 markdown，不包裹 <p> */
  renderInline: (markdown: string) => string;
  /** HTML 转义 */
  escapeHtml: (value: string) => string;
}

export interface EmbedDefinition {
  /** 语法名称：:::name */
  name: string;
  /** 别名，如 :::warning 指向 highlight */
  aliases?: string[];
  /** 说明文字，用于文档与诊断 */
  description?: string;
  /** 语法示例 */
  example?: string;
  /** 渲染逻辑，返回 HTML 字符串 */
  render: (ctx: EmbedRenderContext) => string;
}

export type UnknownEmbedBehavior = 'notice' | 'ignore';

export interface RendererOptions {
  /** 允许内联 HTML，默认 true */
  html?: boolean;
  /** 自动识别链接，默认 true */
  linkify?: boolean;
  /** 排版优化，默认 true */
  typographer?: boolean;
  /** 代码高亮（内置 highlight.js），默认 true */
  highlight?: boolean;
  /** 未注册嵌入体的处理方式，默认 notice，ignore 表示仅渲染内部内容 */
  unknownEmbed?: UnknownEmbedBehavior;
}