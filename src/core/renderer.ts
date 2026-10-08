import MarkdownIt from 'markdown-it';
import type { Options, StateBlock, Token } from 'markdown-it';
import { parseParams } from './attrs';
import { builtinEmbeds } from './embeds/index';
import { highlightCode } from './highlight';
import { EmbedRegistry } from './registry';
import type { EmbedRenderContext, RendererOptions, UnknownEmbedBehavior } from './types';

/** :::name params */
const OPEN_RE = /^(:{3,})\s*([A-Za-z][\w-]*)\s*(.*)$/;

interface EmbedTokenMeta {
  name: string;
  unclosed: boolean;
}

function pushNotice(kind: 'unknown' | 'error' | 'warning', title: string, detail?: string): string {
  const detailHtml = detail ? `<pre class="xdoc-embed__raw">${detail}</pre>` : '';
  return `<div class="xdoc-embed xdoc-embed--${kind}"><div class="xdoc-embed__head">${title}</div>${detailHtml}</div>\n`;
}

/**
 * 块级规则：:::name params ... :::（或更长的 :::）
 * 闭合标记必须为「不少于开启标记长度」的纯冒号行，因此
 * 外层使用 :::: 即可嵌套内层 :::。
 */
function embedRule(state: StateBlock, startLine: number, endLine: number, silent: boolean): boolean {
  if (state.sCount[startLine] - state.blkIndent >= 4) return false;

  const lineStart = state.bMarks[startLine] + state.tShift[startLine];
  const line = state.src.slice(lineStart, state.eMarks[startLine]);
  const match = OPEN_RE.exec(line);
  if (!match) return false;
  if (silent) return true;

  const markerLength = match[1].length;
  const name = match[2];
  const params = match[3].trim();
  const closeRe = new RegExp(`^:{${markerLength},}\\s*$`);

  let closeLine = -1;
  for (let lineNo = startLine + 1; lineNo < endLine; lineNo++) {
    const text = state.src.slice(state.bMarks[lineNo] + state.tShift[lineNo], state.eMarks[lineNo]).trimEnd();
    if (closeRe.test(text)) {
      closeLine = lineNo;
      break;
    }
  }

  const contentEnd = closeLine === -1 ? endLine : closeLine;
  const token = state.push('xdoc_embed', '', 0);
  token.block = true;
  token.info = params;
  token.content = state.getLines(startLine + 1, contentEnd, state.blkIndent, false);
  token.map = [startLine, closeLine === -1 ? endLine : closeLine + 1];
  token.meta = { name, unclosed: closeLine === -1 } satisfies EmbedTokenMeta;

  state.line = closeLine === -1 ? endLine : closeLine + 1;
  return true;
}

function makeEmbedRenderer(md: MarkdownIt, registry: EmbedRegistry, unknownEmbed: UnknownEmbedBehavior) {
  return (tokens: Token[], idx: number, _options: Options, env: Record<string, unknown>): string => {
    const token = tokens[idx];
    const meta = token.meta as EmbedTokenMeta;
    const escapeHtml = (value: string) => md.utils.escapeHtml(value);
    const definition = registry.get(meta.name);

    if (!definition) {
      if (unknownEmbed === 'ignore') {
        return token.content ? `${md.render(token.content, env)}` : '';
      }
      return pushNotice(
        'unknown',
        `未注册的嵌入体 <code>:::${escapeHtml(meta.name)}</code>`,
        escapeHtml(token.content.trim()),
      );
    }

    const { attrs, positional } = parseParams(token.info);
    const ctx: EmbedRenderContext = {
      name: meta.name,
      params: token.info,
      attrs,
      positional,
      content: token.content,
      env,
      render: (source) => md.render(source, env),
      renderInline: (source) => md.renderInline(source, env),
      escapeHtml,
    };

    let html: string;
    try {
      html = definition.render(ctx);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      html = pushNotice(
        'error',
        `嵌入体 <code>:::${escapeHtml(meta.name)}</code> 渲染失败：${escapeHtml(message)}`,
      );
    }

    if (meta.unclosed) {
      html += pushNotice(
        'warning',
        `嵌入体 <code>:::${escapeHtml(meta.name)}</code> 缺少闭合的 <code>:::</code>`,
      );
    }
    return html;
  };
}

export interface XdocRenderer {
  md: MarkdownIt;
  registry: EmbedRegistry;
  render: (markdown: string, env?: Record<string, unknown>) => string;
}

export interface CreateRendererOptions extends RendererOptions {
  registry?: EmbedRegistry;
}

/** 创建带内置嵌入体的注册表 */
export function createRegistry(options: { builtins?: boolean } = {}): EmbedRegistry {
  const registry = new EmbedRegistry();
  if (options.builtins !== false) {
    for (const embed of builtinEmbeds) registry.register(embed);
  }
  return registry;
}

export function createRenderer(options: CreateRendererOptions = {}): XdocRenderer {
  const registry = options.registry ?? createRegistry();
  const unknownEmbed = options.unknownEmbed ?? 'notice';

  const md = new MarkdownIt({
    html: options.html ?? true,
    linkify: options.linkify ?? true,
    typographer: options.typographer ?? true,
    highlight: (options.highlight ?? true) ? highlightCode : undefined,
  });

  md.block.ruler.before('fence', 'xdoc_embed', embedRule, {
    alt: ['paragraph', 'reference', 'blockquote', 'list'],
  });
  md.renderer.rules.xdoc_embed = makeEmbedRenderer(md, registry, unknownEmbed);

  return {
    md,
    registry,
    render: (markdown, env) => md.render(markdown, env ?? {}),
  };
}