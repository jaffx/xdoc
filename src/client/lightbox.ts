/**
 * 图表放大预览浮层。
 *
 * 文档里的图按自然尺寸渲染，小图直接看偏小，点一下在这个浮层里放大看。
 * SVG 是矢量，放多大都不糊。浮层里 − / + 按 20% 步进、点百分比回到 100%、
 * Esc 或点背景或 ✕ 关闭。
 *
 * 只负责「把一份 SVG 放大展示」，什么时候开由调用方决定，见 diagram.ts。
 */

/** 起步缩放到这个宽度：和浮层可视区差不多，太小的图一进来就是大的 */
const START_WIDTH = 1100;
const MIN_SCALE = 0.5;
const MAX_SCALE = 4;
const STEP = 0.2;

let overlay: HTMLElement | null = null;
let focused: HTMLElement | null = null;
let scale = 1;
/** 键盘缩放要能作用到当前浮层，所以缩放函数挂在模块上 */
let zoomTo: ((value: number) => void) | null = null;

/** 图的自然宽度：mermaid 会把它写进 style.maxWidth，取这个最准 */
function naturalWidth(svg: SVGSVGElement): number {
  const inline = Number.parseFloat(svg.style.maxWidth);
  if (Number.isFinite(inline) && inline > 0) return inline;
  const attribute = Number.parseFloat(svg.getAttribute('width') ?? '');
  if (Number.isFinite(attribute) && attribute > 0) return attribute;
  const measured = svg.getBoundingClientRect().width;
  return measured > 0 ? measured : 800;
}

function makeButton(label: string, title: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'xdoc-lightbox__btn';
  button.textContent = label;
  button.title = title;
  button.setAttribute('aria-label', title);
  button.addEventListener('click', onClick);
  return button;
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault();
    closeLightbox();
    return;
  }
  // 键盘也能缩放：+ / - 步进，0 回到实际大小
  let next: number | null = null;
  if (event.key === '+' || event.key === '=') next = scale + STEP;
  else if (event.key === '-' || event.key === '_') next = scale - STEP;
  else if (event.key === '0') next = 1;
  if (next === null) return;
  event.preventDefault();
  zoomTo?.(next);
}

export function closeLightbox(): void {
  if (!overlay) return;
  overlay.remove();
  overlay = null;
  zoomTo = null;
  document.removeEventListener('keydown', onKeydown);
  // 焦点还给触发它的那张图，不然键盘用户关掉浮层后要重新 Tab 一圈
  focused?.focus();
  focused = null;
}

/**
 * 在浮层里放大展示一张 SVG。
 *
 * @param source 已经渲染好的 svg（会被克隆，原图不受影响）
 * @param title  顶部标题，一般传图表的 figcaption
 */
export function openLightbox(source: SVGSVGElement, title?: string): void {
  closeLightbox();

  const natural = naturalWidth(source);
  const clone = source.cloneNode(true) as SVGSVGElement;
  // 去掉 mermaid 写的自然宽度上限，改成按像素设宽。不用 transform 缩放：
  // transform 只放大视觉、不撑大滚动区，图的右下角会被裁掉；设宽则布局跟着
  // 变大，滚动条能拖到全图。
  clone.style.maxWidth = 'none';
  clone.style.height = 'auto';
  clone.style.display = 'block';
  // 比面板窄时居中对齐；比面板宽时 auto 会归零，滚动条照样能拖到左边缘
  clone.style.margin = '0 auto';

  const percent = makeButton('100%', '回到实际大小', () => zoomTo?.(1));
  percent.classList.add('xdoc-lightbox__pct');

  const apply = (value: number) => {
    scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round(value * 10) / 10));
    clone.style.width = `${natural * scale}px`;
    percent.textContent = `${Math.round(scale * 100)}%`;
  };
  zoomTo = apply;
  apply(Math.max(1, Math.round((START_WIDTH / natural) * 10) / 10));

  const close = makeButton('✕', '关闭（Esc）', closeLightbox);
  const controls = document.createElement('div');
  controls.className = 'xdoc-lightbox__controls';
  controls.append(
    makeButton('−', '缩小', () => zoomTo?.(scale - STEP)),
    percent,
    makeButton('+', '放大', () => zoomTo?.(scale + STEP)),
    close,
  );

  const heading = document.createElement('div');
  heading.className = 'xdoc-lightbox__title';
  const name = document.createElement('strong');
  name.textContent = title?.trim() || '图表预览';
  const hint = document.createElement('span');
  hint.className = 'xdoc-lightbox__hint';
  hint.textContent = 'Esc 关闭 · − / + 缩放';
  heading.append(name, hint);

  const head = document.createElement('div');
  head.className = 'xdoc-lightbox__head';
  head.append(heading, controls);

  const body = document.createElement('div');
  body.className = 'xdoc-lightbox__body';
  body.append(clone);

  const panel = document.createElement('div');
  panel.className = 'xdoc-lightbox__panel';
  panel.append(head, body);

  overlay = document.createElement('div');
  overlay.className = 'xdoc-lightbox';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', '图表放大预览');
  overlay.append(panel);
  overlay.addEventListener('click', (event) => {
    // 只有点面板外的背景才关，点图本身（想拖滚动条）不关
    if (event.target === overlay) closeLightbox();
  });

  focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  document.body.append(overlay);
  document.addEventListener('keydown', onKeydown);
  close.focus();
}
