import type { EmbedDefinition } from '../types';

const CHECK_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';

const ITEM_RE = /^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/;

interface TodoItem {
  checked: boolean;
  text: string;
}

/** :::todo title="..." —— 交互式任务清单，支持 - [ ] / - [x] */
export const todoEmbed: EmbedDefinition = {
  name: 'todo',
  description: '交互式 TODO 清单，自动统计完成进度',
  example: ':::todo title="发布清单"\n- [x] 初始化项目\n- [ ] 编写文档\n:::',
  render: (ctx) => {
    const lines = ctx.content.replace(/\r\n?/g, '\n').split('\n');
    const items: TodoItem[] = [];
    const rest: string[] = [];

    for (const line of lines) {
      const match = ITEM_RE.exec(line);
      if (match) items.push({ checked: match[1].toLowerCase() === 'x', text: match[2].trim() });
      else rest.push(line);
    }

    const total = items.length;
    const done = items.filter((item) => item.checked).length;
    const percent = total === 0 ? 0 : Math.round((done / total) * 100);
    const title = ctx.attrs.title ?? ctx.positional.join(' ');

    const list = items
      .map(
        (item) => `<li class="xdoc-todo__item${item.checked ? ' is-done' : ''}">
  <label class="xdoc-todo__label">
    <input type="checkbox"${item.checked ? ' checked' : ''}>
    <span class="xdoc-todo__check" aria-hidden="true">${CHECK_SVG}</span>
    <span class="xdoc-todo__text">${ctx.renderInline(item.text)}</span>
  </label>
</li>`,
      )
      .join('\n');

    const restSource = rest.join('\n').trim();
    const restHtml = restSource ? `\n<div class="xdoc-todo__rest">${ctx.render(restSource)}</div>` : '';

    return `<div class="xdoc-todo" data-xdoc-todo data-done="${done}" data-total="${total}">
<div class="xdoc-todo__head">
${title ? `<div class="xdoc-todo__title">${ctx.escapeHtml(title)}</div>` : '<div class="xdoc-todo__title"></div>'}
<div class="xdoc-todo__progress">
<span class="xdoc-todo__bar"><i style="width:${percent}%"></i></span>
<span class="xdoc-todo__count">${done}/${total}</span>
</div>
</div>
<ul class="xdoc-todo__list">
${list}
</ul>${restHtml}</div>\n`;
  },
};