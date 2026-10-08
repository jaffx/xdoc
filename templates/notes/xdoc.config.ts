import type { EmbedDefinition } from 'xdoc';

/**
 * notes 空间自己的扩展配置。
 * 每个空间独立加载 xdoc.config.ts，互不影响。
 */
export default function setup(api: {
  registerEmbed: (definition: EmbedDefinition) => void;
  addStyles: (css: string) => void;
}) {
  api.addStyles(`
    .xdoc-quote {
      position: relative;
      margin: 1.2em 0;
      padding: 14px 18px 14px 22px;
      border-left: 3px solid var(--accent);
      border-radius: 0 10px 10px 0;
      background: var(--accent-soft);
      font-size: 15px;
    }
    .xdoc-quote p { margin: 0.3em 0; color: var(--text); }
    .xdoc-quote cite {
      display: block;
      margin-top: 8px;
      font-size: 12.5px;
      font-style: normal;
      color: var(--text-mute);
    }
  `);

  api.registerEmbed({
    name: 'quote',
    description: '带署名的引用（notes 空间专属）',
    example: ':::quote author="某人"\n内容\n:::',
    render: (ctx) => {
      const author = ctx.attrs.author ?? ctx.attrs.by ?? '';
      const cite = author ? `<cite>—— ${ctx.escapeHtml(author)}</cite>` : '';
      return `<blockquote class="xdoc-quote">${ctx.render(ctx.content)}${cite}</blockquote>\n`;
    },
  });
}