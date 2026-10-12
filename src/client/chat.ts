import {
  clearChatHistory,
  fetchChatHistory,
  renderMarkdown,
  withToken,
  type ChatTurn,
} from './api';
import { renderDiagrams } from './diagram';

interface Turn {
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string;
  stopped?: boolean;
}

interface AssistantRefs {
  root: HTMLElement;
  thinking: HTMLDetailsElement;
  thinkingBody: HTMLElement;
  tool: HTMLElement;
  typing: HTMLElement;
  content: HTMLElement;
  /** 已流式出现但尚未渲染的文本尾巴（纯文本展示） */
  pending: HTMLElement;
  note: HTMLElement;
  /** 已渲染到 content 里的字符数 */
  renderedOffset: number;
  /** 串行化渲染请求，保证块顺序 */
  renderChain: Promise<void>;
  flushTimer: number | undefined;
}

const TOOL_LABELS: Record<string, string> = {
  read_doc: '正在读取文档…',
  list_docs: '正在浏览文档列表…',
  search_docs: '正在搜索文档…',
};

const state = {
  isOpen: false,
  isGenerating: false,
  selectedText: '',
  turns: [] as Turn[],
  abort: null as AbortController | null,
  /** 当前已加载历史对应的空间；null 表示未加载 */
  loadedSpace: null as string | null,
  getSpace: (() => null) as () => string | null,
  getDocPath: (() => null) as () => string | null,
};

let dialogEl: HTMLElement | null = null;
let scrollEl: HTMLElement | null = null;
let messagesEl: HTMLElement | null = null;
let emptyEl: HTMLElement | null = null;
let inputEl: HTMLTextAreaElement | null = null;
let sendBtn: HTMLButtonElement | null = null;
let quoteEl: HTMLElement | null = null;
let quoteTextEl: HTMLElement | null = null;
let docEl: HTMLElement | null = null;

const SEND_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 7-7 7 7"/><path d="M12 19V5"/></svg>';
const STOP_ICON =
  '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="7" y="7" width="10" height="10" rx="1.5"/></svg>';

export function initChatDialog(getSpace: () => string | null, getDocPath: () => string | null) {
  if (dialogEl) return;
  state.getSpace = getSpace;
  state.getDocPath = getDocPath;

  dialogEl = document.createElement('div');
  dialogEl.className = 'chat-dialog';
  dialogEl.innerHTML = `
    <header class="chat-header">
      <div class="chat-title"><span class="chat-title__dot"></span>AI 助手</div>
      <div class="chat-header__actions">
        <button type="button" class="chat-icon-btn chat-clear" title="清空对话" aria-label="清空对话">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>
        </button>
        <button type="button" class="chat-icon-btn chat-close" title="关闭" aria-label="关闭">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>
      </div>
    </header>
    <div class="chat-scroll">
      <div class="chat-empty">
        <div class="chat-empty__icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        </div>
        <div class="chat-empty__title">基于当前空间的文档回答</div>
        <div class="chat-empty__hint">对话按空间分别保存，选中正文可引用提问</div>
      </div>
      <div class="chat-messages"></div>
    </div>
    <div class="chat-input-area">
      <div class="chat-doc" hidden></div>
      <div class="chat-quote" hidden>
        <span class="chat-quote__text"></span>
        <button type="button" class="chat-quote__clear" title="移除引用" aria-label="移除引用">&times;</button>
      </div>
      <div class="chat-input-row">
        <textarea rows="1" placeholder="输入问题，Enter 发送" aria-label="输入问题"></textarea>
        <button type="button" class="chat-send" title="发送" aria-label="发送"></button>
      </div>
    </div>
  `;
  document.body.appendChild(dialogEl);

  scrollEl = dialogEl.querySelector('.chat-scroll');
  messagesEl = dialogEl.querySelector('.chat-messages');
  emptyEl = dialogEl.querySelector('.chat-empty');
  inputEl = dialogEl.querySelector('textarea');
  sendBtn = dialogEl.querySelector('.chat-send');
  quoteEl = dialogEl.querySelector('.chat-quote');
  quoteTextEl = dialogEl.querySelector('.chat-quote__text');
  docEl = dialogEl.querySelector('.chat-doc');

  updateSendButton();
  renderDocPill();

  dialogEl.querySelector('.chat-close')?.addEventListener('click', closeChatDialog);
  dialogEl.querySelector('.chat-clear')?.addEventListener('click', clearChat);
  dialogEl.querySelector('.chat-quote__clear')?.addEventListener('click', () => {
    state.selectedText = '';
    renderQuote();
  });
  sendBtn?.addEventListener('click', () => {
    if (state.isGenerating) state.abort?.abort();
    else void send();
  });

  inputEl?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      if (!state.isGenerating) void send();
    }
  });
  inputEl?.addEventListener('input', autoGrow);

  document.addEventListener('mouseup', handleSelection);
}

function handleSelection() {
  const selection = window.getSelection();
  const text = selection?.toString().trim() ?? '';
  const anchor = selection?.anchorNode;
  const inContent = anchor instanceof Node && document.querySelector('#content')?.contains(anchor);
  const next = inContent && text && text.length <= 2000 ? text : '';
  if (next === state.selectedText) return;
  state.selectedText = next;
  if (state.isOpen) renderQuote();
}

function renderQuote() {
  if (!quoteEl || !quoteTextEl) return;
  if (state.selectedText) {
    quoteEl.hidden = false;
    quoteTextEl.textContent =
      state.selectedText.length > 120 ? state.selectedText.slice(0, 120) + '…' : state.selectedText;
  } else {
    quoteEl.hidden = true;
  }
}

/** 输入区上方的「当前文档」提示 */
function renderDocPill() {
  if (!docEl) return;
  const docPath = state.getDocPath();
  if (docPath) {
    const name = docPath.split('/').pop() ?? docPath;
    docEl.hidden = false;
    docEl.textContent = `📄 ${name}`;
    docEl.title = `当前文档：${docPath}`;
  } else {
    docEl.hidden = true;
  }
}

/** 当前打开的文档变化时由外部调用 */
export function syncChatDoc() {
  renderDocPill();
}

/** 空间切换时由外部调用：中止生成、清空并（若开着）加载新空间的历史 */
export function notifySpaceChanged() {
  if (state.isGenerating) state.abort?.abort();
  state.loadedSpace = null;
  state.turns = [];
  if (messagesEl) messagesEl.innerHTML = '';
  if (emptyEl) emptyEl.hidden = false;
  renderDocPill();
  if (state.isOpen) void loadHistory();
}

export function openChatDialog(initialQuestion?: string) {
  if (!dialogEl) return;
  state.isOpen = true;
  dialogEl.classList.add('open');
  renderQuote();
  renderDocPill();
  void loadHistory();
  if (initialQuestion && inputEl) {
    inputEl.value = initialQuestion;
    autoGrow();
  }
  inputEl?.focus();
}

export function closeChatDialog() {
  if (!dialogEl) return;
  state.isOpen = false;
  dialogEl.classList.remove('open');
  // 关闭时若还在生成，立即中止，后台同步停止
  if (state.isGenerating) state.abort?.abort();
}

function clearChat() {
  if (state.isGenerating) state.abort?.abort();
  state.turns = [];
  if (messagesEl) messagesEl.innerHTML = '';
  if (emptyEl) emptyEl.hidden = false;
  const space = state.getSpace();
  if (space) {
    void clearChatHistory(space).catch(() => {
      /* 服务端不可用时至少本地已清空 */
    });
  }
}

/** 加载当前空间的历史对话（已加载过则跳过） */
async function loadHistory(force = false) {
  const space = state.getSpace();
  const key = space ?? '';
  if (!force && state.loadedSpace === key) return;
  state.loadedSpace = key;
  state.turns = [];
  if (messagesEl) messagesEl.innerHTML = '';
  if (emptyEl) emptyEl.hidden = false;
  if (!space) return;

  let turns: ChatTurn[] = [];
  try {
    ({ turns } = await fetchChatHistory(space));
  } catch {
    return;
  }
  if (state.loadedSpace !== key) return; // 加载期间又切了空间
  for (const turn of turns) {
    if (turn.role === 'user') {
      addUserBubble(turn.content, '');
      state.turns.push({ role: 'user', content: turn.content });
    } else {
      const refs = addAssistantBubble();
      const local: Turn = { role: 'assistant', content: turn.content, stopped: turn.stopped };
      state.turns.push(local);
      if (turn.stopped) {
        refs.note.hidden = false;
        refs.note.textContent = '已停止';
      }
      void finalizeAssistant(refs, local);
    }
  }
  scrollToBottom(true);
}

function autoGrow() {
  if (!inputEl) return;
  inputEl.style.height = 'auto';
  inputEl.style.height = Math.min(inputEl.scrollHeight, 132) + 'px';
}

function updateSendButton() {
  if (!sendBtn) return;
  sendBtn.classList.toggle('is-stop', state.isGenerating);
  sendBtn.innerHTML = state.isGenerating ? STOP_ICON : SEND_ICON;
  sendBtn.title = state.isGenerating ? '停止生成' : '发送';
  sendBtn.setAttribute('aria-label', state.isGenerating ? '停止生成' : '发送');
}

function scrollToBottom(force = false) {
  if (!scrollEl) return;
  const gap = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight;
  if (force || gap < 80) scrollEl.scrollTop = scrollEl.scrollHeight;
}

function addUserBubble(question: string, quote: string) {
  if (!messagesEl || !emptyEl) return;
  emptyEl.hidden = true;
  const el = document.createElement('div');
  el.className = 'chat-message chat-message--user';
  const bubble = document.createElement('div');
  bubble.className = 'chat-bubble';
  if (quote) {
    const quoteBlock = document.createElement('div');
    quoteBlock.className = 'chat-bubble__quote';
    quoteBlock.textContent = quote.length > 120 ? quote.slice(0, 120) + '…' : quote;
    bubble.appendChild(quoteBlock);
  }
  const text = document.createElement('div');
  text.textContent = question;
  bubble.appendChild(text);
  el.appendChild(bubble);
  messagesEl.appendChild(el);
  scrollToBottom(true);
}

function addAssistantBubble(): AssistantRefs {
  if (!messagesEl) throw new Error('messages 容器未初始化');
  emptyEl!.hidden = true;

  const root = document.createElement('div');
  root.className = 'chat-message chat-message--assistant';
  root.innerHTML = `
    <div class="chat-bubble">
      <details class="chat-thinking" hidden>
        <summary>思考过程</summary>
        <div class="chat-thinking__body"></div>
      </details>
      <div class="chat-tool" hidden></div>
      <div class="chat-typing"><span></span><span></span><span></span></div>
      <div class="chat-content"><div class="chat-pending"></div></div>
      <div class="chat-note" hidden></div>
    </div>
  `;
  messagesEl.appendChild(root);
  scrollToBottom(true);

  return {
    root,
    thinking: root.querySelector('.chat-thinking') as HTMLDetailsElement,
    thinkingBody: root.querySelector('.chat-thinking__body') as HTMLElement,
    tool: root.querySelector('.chat-tool') as HTMLElement,
    typing: root.querySelector('.chat-typing') as HTMLElement,
    content: root.querySelector('.chat-content') as HTMLElement,
    pending: root.querySelector('.chat-pending') as HTMLElement,
    note: root.querySelector('.chat-note') as HTMLElement,
    renderedOffset: 0,
    renderChain: Promise.resolve(),
    flushTimer: undefined,
  };
}

function removeTyping(refs: AssistantRefs) {
  refs.typing.remove();
}

async function send() {
  if (state.isGenerating || !inputEl) return;
  const question = inputEl.value.trim();
  if (!question) return;

  const quote = state.selectedText;
  const payload = quote ? `[引用文档内容]\n${quote}\n\n[问题]\n${question}` : question;

  state.turns.push({ role: 'user', content: payload });
  addUserBubble(question, quote);

  inputEl.value = '';
  autoGrow();
  state.selectedText = '';
  renderQuote();
  renderDocPill();

  state.isGenerating = true;
  updateSendButton();
  const refs = addAssistantBubble();
  const turn: Turn = { role: 'assistant', content: '' };
  const controller = new AbortController();
  state.abort = controller;

  try {
    const response = await fetch(withToken(chatUrl()), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: payload, docPath: state.getDocPath() ?? undefined }),
      signal: controller.signal,
    });
    if (!response.ok || !response.body) {
      let message = `请求失败（${response.status}）`;
      try {
        const data = (await response.json()) as { error?: string };
        if (data?.error) message = data.error;
      } catch {
        // 响应不是 JSON 时保持默认信息
      }
      throw new Error(message);
    }
    await consumeStream(response.body, refs, turn);
    if (turn.stopped) {
      refs.note.hidden = false;
      refs.note.textContent = '已停止';
    }
    await finalizeAssistant(refs, turn);
  } catch (error) {
    const aborted = (error as Error)?.name === 'AbortError';
    if (aborted) {
      turn.stopped = true;
      refs.note.hidden = false;
      refs.note.textContent = '已停止';
      await finalizeAssistant(refs, turn);
    } else {
      removeTyping(refs);
      refs.note.hidden = false;
      refs.note.textContent = `出错：${(error as Error)?.message ?? String(error)}`;
      refs.note.classList.add('chat-note--error');
    }
  } finally {
    removeTyping(refs);
    refs.tool.hidden = true;
    refs.thinking.open = false;
    if (turn.content.trim()) state.turns.push(turn);
    state.isGenerating = false;
    state.abort = null;
    updateSendButton();
    scrollToBottom();
  }
}

async function consumeStream(body: ReadableStream<Uint8Array>, refs: AssistantRefs, turn: Turn) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      let event: { type?: string; delta?: string; name?: string; message?: string };
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }
      switch (event.type) {
        case 'reasoning':
          removeTypingOnce(refs);
          refs.thinking.hidden = false;
          refs.thinking.open = true;
          turn.reasoning = (turn.reasoning ?? '') + (event.delta ?? '');
          refs.thinkingBody.textContent = turn.reasoning;
          scrollToBottom();
          break;
        case 'text':
          removeTypingOnce(refs);
          refs.tool.hidden = true;
          refs.thinking.open = false;
          turn.content += event.delta ?? '';
          refs.pending.textContent = turn.content.slice(refs.renderedOffset);
          scheduleFlush(refs, turn);
          scrollToBottom();
          break;
        case 'tool':
          removeTypingOnce(refs);
          refs.tool.hidden = false;
          refs.tool.textContent = TOOL_LABELS[event.name ?? ''] ?? '正在查阅文档…';
          scrollToBottom();
          break;
        case 'error':
          throw new Error(event.message || '生成失败');
        default:
          break;
      }
    }
  }
}

function removeTypingOnce(refs: AssistantRefs) {
  if (refs.typing.isConnected) refs.typing.remove();
}

/**
 * 找出可以安全渲染的截止位置：最后一个「完整块」的边界（空行之后），
 * 且不落在未闭合的代码围栏 / 嵌入体内。返回值为字符下标。
 */
function safeCut(text: string): number {
  let inFence = false;
  let embedDepth = 0;
  let cut = 0;
  let pos = 0;
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) {
      inFence = !inFence;
    } else if (!inFence && /^:{3,}\s*\S/.test(trimmed)) {
      embedDepth += 1;
    } else if (!inFence && /^:{3,}$/.test(trimmed)) {
      embedDepth = Math.max(0, embedDepth - 1);
    }
    pos += line.length + 1;
    // 末行没有换行符时 pos 会多算 1，这里按实际长度修正
    if (i === lines.length - 1) pos = text.length;
    // 只在「真正的空行」处切：文本以 \n 结尾时 split 出的最后一项是空字符串，不是空行
    if (!inFence && embedDepth === 0 && trimmed === '' && i < lines.length - 1) cut = pos;
  }
  return cut;
}

/** 把 [renderedOffset, cut) 的文本渲染成 HTML 插到尾巴元素之前 */
function flushNow(refs: AssistantRefs, turn: Turn, final = false) {
  const total = turn.content;
  const cut = final ? total.length : safeCut(total);
  if (cut <= refs.renderedOffset) return;

  const segment = total.slice(refs.renderedOffset, cut);
  refs.renderedOffset = cut;
  const space = state.getSpace() ?? '';

  refs.renderChain = refs.renderChain.then(async () => {
    try {
      const { html } = await renderMarkdown(space, segment);
      const holder = document.createElement('div');
      holder.innerHTML = html;
      while (holder.firstChild) {
        refs.content.insertBefore(holder.firstChild, refs.pending);
      }
      renderDiagrams(refs.content);
    } catch {
      // 渲染服务不可用时，该段退回纯文本块
      const plain = document.createElement('div');
      plain.className = 'chat-chunk-plain';
      plain.textContent = segment;
      refs.content.insertBefore(plain, refs.pending);
    }
    scrollToBottom();
  });

  refs.pending.textContent = total.slice(refs.renderedOffset);
}

function scheduleFlush(refs: AssistantRefs, turn: Turn) {
  if (refs.flushTimer !== undefined) return;
  refs.flushTimer = window.setTimeout(() => {
    refs.flushTimer = undefined;
    flushNow(refs, turn);
  }, 150);
}

/** 收尾：把剩余文本全部渲染，清空尾巴。历史加载（非流式）也走这里 */
async function finalizeAssistant(refs: AssistantRefs, turn: Turn) {
  removeTypingOnce(refs);
  if (refs.flushTimer !== undefined) {
    window.clearTimeout(refs.flushTimer);
    refs.flushTimer = undefined;
  }
  if (!turn.content.trim()) {
    refs.pending.remove();
    return;
  }
  flushNow(refs, turn, true);
  await refs.renderChain;
  refs.pending.textContent = '';
  scrollToBottom(true);
}

function chatUrl(): string {
  const space = state.getSpace();
  return space ? `/api/chat/stream?space=${encodeURIComponent(space)}` : '/api/chat/stream';
}