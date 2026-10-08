import type { EmbedDefinition, EmbedRenderContext } from '../types';

const VARIANTS = ['note', 'info', 'tip', 'success', 'warning', 'danger'] as const;
type Variant = (typeof VARIANTS)[number];

const LABELS: Record<Variant, string> = {
  note: '说明',
  info: '信息',
  tip: '提示',
  success: '完成',
  warning: '注意',
  danger: '危险',
};

const ICONS: Record<Variant, string> = {
  note: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4z"/><path d="m14 6 4 4"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/>',
  tip: '<path d="M9 18h6"/><path d="M10 21h4"/><path d="M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3z"/>',
  success: '<circle cx="12" cy="12" r="9"/><path d="m8.5 12.5 2.5 2.5 4.5-5"/>',
  warning: '<path d="M12 4 2.7 20h18.6L12 4z"/><path d="M12 10v4"/><path d="M12 17h.01"/>',
  danger: '<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6"/><path d="m15 9-6 6"/>',
};

function isVariant(value: string | undefined): value is Variant {
  return value !== undefined && (VARIANTS as readonly string[]).includes(value);
}

function resolveVariant(ctx: EmbedRenderContext): Variant {
  if (isVariant(ctx.name)) return ctx.name;
  if (isVariant(ctx.attrs.type)) return ctx.attrs.type;
  return 'note';
}

function resolveTitle(ctx: EmbedRenderContext, variant: Variant, consumed: boolean): string | undefined {
  if (ctx.attrs.title !== undefined) return ctx.attrs.title || undefined;
  const rest = consumed ? ctx.positional.slice(1) : ctx.positional;
  const title = rest.join(' ').trim();
  return title || LABELS[variant];
}

/** :::highlight type=warning title="..." / :::warning 标题 */
export const calloutEmbed: EmbedDefinition = {
  name: 'highlight',
  aliases: [...VARIANTS],
  description: '高亮/提示块，支持 note、info、tip、success、warning、danger 变体',
  example: ':::warning 注意\n支持 **markdown** 内容\n:::',
  render: (ctx) => {
    const variant = resolveVariant(ctx);
    const consumed = ctx.name === 'highlight' && isVariant(ctx.positional[0]);
    const title = resolveTitle(ctx, variant, consumed);
    const body = ctx.render(ctx.content).trim();
    const titleHtml = title ? `<div class="xdoc-callout__title">${ctx.escapeHtml(title)}</div>` : '';
    return [
      `<div class="xdoc-callout xdoc-callout--${variant}">`,
      `<div class="xdoc-callout__icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[variant]}</svg></div>`,
      `<div class="xdoc-callout__body">${titleHtml}${body}</div>`,
      `</div>\n`,
    ].join('');
  },
};