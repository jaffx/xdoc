/**
 * 图表嵌入体的浏览器端渲染：mermaid 与 echarts。
 *
 * 两个库体积都不小，都不进主 bundle，放在 /vendor/ 下按需加载：
 * echarts 注入 <script>，mermaid 用动态 import 以复用它的懒加载分块。
 * 文档里没有对应嵌入体时，两者都不会被请求。
 */

type Theme = 'light' | 'dark';

interface MermaidApi {
  initialize: (config: Record<string, unknown>) => void;
  render: (id: string, source: string) => Promise<{ svg: string }>;
}

interface EchartsInstance {
  setOption: (option: unknown) => void;
  resize: () => void;
  dispose: () => void;
}

interface EchartsApi {
  init: (el: HTMLElement, theme?: string | null) => EchartsInstance;
}

declare global {
  interface Window {
    echarts?: EchartsApi;
  }
}

const scriptCache = new Map<string, Promise<void>>();

function loadScript(src: string): Promise<void> {
  const cached = scriptCache.get(src);
  if (cached) return cached;
  const task = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`加载失败：${src}`));
    document.head.append(script);
  }).catch((error) => {
    scriptCache.delete(src);
    throw error;
  });
  scriptCache.set(src, task);
  return task;
}

/**
 * mermaid 的 ESM 产物按图类型拆成懒加载分块，
 * 用动态 import 引入，浏览器只会拉取文档里实际用到的图类型。
 * 路径写成变量以避免被 esbuild 静态解析打包进来。
 */
const MERMAID_URL = '/vendor/mermaid/mermaid.esm.min.mjs';
let mermaidModule: Promise<MermaidApi> | null = null;

function loadMermaid(): Promise<MermaidApi> {
  if (!mermaidModule) {
    mermaidModule = import(/* @vite-ignore */ MERMAID_URL)
      .then((mod: { default: MermaidApi }) => mod.default)
      .catch((error) => {
        mermaidModule = null;
        throw error;
      });
  }
  return mermaidModule;
}

function currentTheme(): Theme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

/** 读取嵌入体渲染时写入的原始源码（已 HTML 转义，用 textContent 取回） */
function readSource(figure: HTMLElement): string {
  return figure.querySelector('.xdoc-diagram__src')?.textContent?.trim() ?? '';
}

function showError(view: HTMLElement, message: string) {
  view.innerHTML = '';
  const box = document.createElement('div');
  box.className = 'xdoc-diagram__error';
  box.textContent = message;
  view.append(box);
}

// ---------- mermaid ----------

let mermaidTheme: Theme | null = null;
let mermaidSeq = 0;

async function getMermaid(theme: Theme): Promise<MermaidApi> {
  const api = await loadMermaid();
  // 主题只能全局设置，切换主题时需重新 initialize 再整页重绘
  if (mermaidTheme !== theme) {
    api.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: theme === 'dark' ? 'dark' : 'default',
      fontFamily: 'inherit',
    });
    mermaidTheme = theme;
  }
  return api;
}

async function renderMermaid(figure: HTMLElement, theme: Theme) {
  const view = figure.querySelector<HTMLElement>('.xdoc-mermaid__view');
  if (!view) return;
  const source = readSource(figure);
  if (!source) return;

  try {
    const api = await getMermaid(theme);
    const { svg } = await api.render(`xdoc-mermaid-${++mermaidSeq}`, source);
    view.innerHTML = svg;
    figure.dataset.rendered = theme;
  } catch (error) {
    showError(view, `mermaid 渲染失败：${error instanceof Error ? error.message : String(error)}`);
  }
}

// ---------- echarts ----------

/**
 * option 允许写 JS 对象字面量（非严格 JSON），因此先试 JSON.parse，
 * 失败再用 Function 求值。源码来自本地文档，与文档内允许的原始 HTML 同级信任。
 */
function parseOption(source: string): unknown {
  try {
    return JSON.parse(source);
  } catch {
    return new Function(`return (${source});`)();
  }
}

const chartInstances = new WeakMap<HTMLElement, EchartsInstance>();
const liveCharts = new Set<HTMLElement>();

async function renderEcharts(figure: HTMLElement, theme: Theme) {
  const view = figure.querySelector<HTMLElement>('.xdoc-echarts__view');
  if (!view) return;
  const source = readSource(figure);
  if (!source) return;

  try {
    await loadScript('/vendor/echarts.js');
    const api = window.echarts;
    if (!api) throw new Error('echarts 未就绪');

    const option = parseOption(source);
    // 主题在 init 时固定，切主题需要销毁重建
    chartInstances.get(view)?.dispose();
    const chart = api.init(view, theme === 'dark' ? 'dark' : null);
    chart.setOption(option);
    chartInstances.set(view, chart);
    liveCharts.add(view);
    figure.dataset.rendered = theme;
  } catch (error) {
    showError(view, `echarts 渲染失败：${error instanceof Error ? error.message : String(error)}`);
  }
}

// ---------- 对外接口 ----------

/** 容器尺寸变化时重算图表布局 */
let resizeBound = false;
function bindResize() {
  if (resizeBound) return;
  resizeBound = true;
  window.addEventListener('resize', () => {
    for (const view of liveCharts) {
      if (view.isConnected) chartInstances.get(view)?.resize();
      else liveCharts.delete(view);
    }
  });
}

/** 渲染 root 内所有图表嵌入体；已按当前主题渲染过的跳过 */
export function renderDiagrams(root: HTMLElement) {
  const theme = currentTheme();

  // 文档重新渲染后旧容器会脱离 DOM，释放其 echarts 实例
  for (const view of liveCharts) {
    if (!view.isConnected) {
      chartInstances.get(view)?.dispose();
      liveCharts.delete(view);
    }
  }

  const mermaids = root.querySelectorAll<HTMLElement>('[data-xdoc-mermaid]');
  const charts = root.querySelectorAll<HTMLElement>('[data-xdoc-echarts]');
  if (mermaids.length === 0 && charts.length === 0) return;

  bindResize();
  for (const figure of mermaids) {
    if (figure.dataset.rendered !== theme) void renderMermaid(figure, theme);
  }
  for (const figure of charts) {
    if (figure.dataset.rendered !== theme) void renderEcharts(figure, theme);
  }
}
