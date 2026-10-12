import { chat, type ChatMessage } from './api';

interface ChatDialogState {
  isOpen: boolean;
  messages: ChatMessage[];
  isLoading: boolean;
  selectedText: string;
}

const state: ChatDialogState = {
  isOpen: false,
  messages: [],
  isLoading: false,
  selectedText: '',
};

let dialogEl: HTMLElement | null = null;
let messagesEl: HTMLElement | null = null;
let inputEl: HTMLTextAreaElement | null = null;
let selectedTextEl: HTMLElement | null = null;

export function initChatDialog() {
  dialogEl = document.createElement('div');
  dialogEl.className = 'chat-dialog';
  dialogEl.innerHTML = `
    <div class="chat-header">
      <span>AI 助手</span>
      <button class="chat-close">&times;</button>
    </div>
    <div class="chat-selected-text" style="display: none;">
      <div class="selected-label">选中的内容：</div>
      <div class="selected-content"></div>
    </div>
    <div class="chat-messages"></div>
    <div class="chat-input-area">
      <textarea placeholder="输入问题...（Enter 发送，Shift+Enter 换行）" rows="2"></textarea>
      <button class="chat-send">发送</button>
    </div>
  `;
  document.body.appendChild(dialogEl);

  messagesEl = dialogEl.querySelector('.chat-messages');
  inputEl = dialogEl.querySelector('textarea');
  selectedTextEl = dialogEl.querySelector('.chat-selected-text');

  dialogEl.querySelector('.chat-close')?.addEventListener('click', closeChatDialog);
  dialogEl.querySelector('.chat-send')?.addEventListener('click', sendMessage);
  
  inputEl?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  document.addEventListener('mouseup', handleTextSelection);
}

function handleTextSelection() {
  const selection = window.getSelection();
  const text = selection?.toString().trim();
  
  if (text && text.length > 0 && text.length < 2000) {
    state.selectedText = text;
  } else {
    state.selectedText = '';
  }
}

export function openChatDialog(initialQuestion?: string) {
  if (!dialogEl) initChatDialog();
  
  state.isOpen = true;
  dialogEl!.classList.add('open');
  
  if (state.selectedText && selectedTextEl) {
    selectedTextEl.style.display = 'block';
    selectedTextEl.querySelector('.selected-content')!.textContent = state.selectedText.slice(0, 200) + (state.selectedText.length > 200 ? '...' : '');
  } else if (selectedTextEl) {
    selectedTextEl.style.display = 'none';
  }
  
  if (initialQuestion && inputEl) {
    inputEl.value = initialQuestion;
    setTimeout(() => sendMessage(), 100);
  } else {
    inputEl?.focus();
  }
}

export function closeChatDialog() {
  state.isOpen = false;
  dialogEl?.classList.remove('open');
  state.selectedText = '';
}

export function askAboutSelection() {
  if (state.selectedText) {
    openChatDialog(`请解释这段内容：\n\n${state.selectedText}`);
  }
}

async function sendMessage() {
  if (!inputEl || !messagesEl || state.isLoading) return;
  
  const content = inputEl.value.trim();
  if (!content) return;
  
  const contextPrefix = state.selectedText 
    ? `[参考内容]: ${state.selectedText}\n\n` 
    : '';
  
  const userMessage: ChatMessage = {
    role: 'user',
    content: contextPrefix + content,
  };
  
  state.messages.push(userMessage);
  appendMessage(userMessage);
  
  inputEl.value = '';
  state.isLoading = true;
  
  try {
    const space = getCurrentSpace();
    const response = await chat(state.messages, space);
    
    const assistantMessage: ChatMessage = {
      role: 'assistant',
      content: response.reply,
    };
    
    state.messages.push(assistantMessage);
    appendMessage(assistantMessage);
  } catch (error: any) {
    appendMessage({
      role: 'assistant',
      content: `错误：${error.message}`,
    });
  } finally {
    state.isLoading = false;
  }
}

function appendMessage(message: ChatMessage) {
  if (!messagesEl) return;
  
  const msgEl = document.createElement('div');
  msgEl.className = `chat-message ${message.role}`;
  msgEl.textContent = message.content;
  messagesEl.appendChild(msgEl);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function getCurrentSpace(): string {
  const url = new URL(window.location.href);
  return url.searchParams.get('space') || 'xdoc';
}
