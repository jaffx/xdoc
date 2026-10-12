import { fetchSettings, patchSettings, setToken, type SettingsPatch, type SettingsView } from './api';

/** 密钥字段的说明随配置来路变，照实说清楚现在读的是哪一份 */
const SOURCE_HINT: Record<SettingsView['ai']['source'], string> = {
  xdoc: '保存在服务端数据根目录的 config.json 里，接口只回掩码。',
  opencode: '当前读的是 ~/.config/opencode/opencode.json；在这里填一个，就改用这里的。',
  none: '还没配置。填上 API Key 才能用 AI 助手。',
};

type SecretField = 'apiKey' | 'token';

/** 面板顶部的分区 */
type PanelTab = 'settings' | 'mcp';

/** MCP 接入里可切换的客户端 */
type McpClient = 'claude-code' | 'opencode';

/** 能复制的片段：端点地址 + 各客户端的接入配置 */
type SnippetKey = 'url' | 'claude-code-cmd' | 'claude-code-json' | 'opencode-json';

/**
 * 设置面板：AI 参数与访问令牌，写回服务端数据根目录的 config.json。
 *
 * 密钥一律不回显——输入框只拿掩码当 placeholder。因此「输入框留空」表示不改动，
 * 要清掉已存的密钥得点一下「清除」。
 */
export class SettingsPanel {
  #modal: HTMLElement | null = null;
  #view: SettingsView | null = null;
  /** 被点了「清除」、保存时要置空的密钥字段 */
  #cleared = new Set<SecretField>();

  #apiKey!: HTMLInputElement;
  #baseURL!: HTMLInputElement;
  #model!: HTMLInputElement;
  #token!: HTMLInputElement;
  #apiKeyClear!: HTMLButtonElement;
  #tokenClear!: HTMLButtonElement;
  #source!: HTMLElement;
  #status!: HTMLElement;
  #saveBtn!: HTMLButtonElement;

  // ---- MCP 接入 ----
  #tabButtons: HTMLButtonElement[] = [];
  #clientTabs: HTMLButtonElement[] = [];
  #mcpUrl!: HTMLElement;
  #mcpAuth!: HTMLElement;
  /** 当前该拿出去的片段，随「服务端有没有开令牌」在 #renderMcp 里重建 */
  #snippets = new Map<SnippetKey, string>();

  open(): void {
    this.#mount();
    this.#modal!.hidden = false;
    document.body.classList.add('is-modal-open');
    this.#setStatus('');
    // 每次从「设置」开起，MCP 接入是个看一眼就走的页签，没必要记住上次停在哪
    this.#switchTab('settings');
    void this.#load();
  }

  close(): void {
    if (!this.#modal || this.#modal.hidden) return;
    this.#modal.hidden = true;
    document.body.classList.remove('is-modal-open');
  }

  // ---------- DOM ----------

  #mount(): void {
    if (this.#modal) return;
    const el = document.createElement('div');
    el.id = 'settings-modal';
    el.className = 'settings-modal';
    el.hidden = true;
    el.innerHTML = `
      <div class="settings-modal__backdrop"></div>
      <div class="settings-panel" role="dialog" aria-modal="true" aria-label="设置">
        <div class="settings-panel__head">
          <div class="settings-tabs" role="tablist" aria-label="设置分区">
            <button type="button" class="settings-tab is-active" data-tab="settings" role="tab" id="settings-tab-btn" aria-selected="true" aria-controls="settings-pane">设置</button>
            <button type="button" class="settings-tab" data-tab="mcp" role="tab" id="settings-tab-mcp" aria-selected="false" aria-controls="settings-pane-mcp">MCP 接入</button>
          </div>
          <button type="button" class="icon-btn settings-panel__close" title="关闭（Esc）" aria-label="关闭">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
          </button>
        </div>
        <div class="settings-panel__body" id="settings-pane" data-pane="settings" role="tabpanel" aria-labelledby="settings-tab-btn">
          <section class="settings-section">
            <h3 class="settings-section__title">AI 助手</h3>
            <p class="settings-section__hint" data-source></p>
            <div class="settings-field">
              <label class="settings-field__label" for="settings-apikey">
                <span>API Key</span>
                <button type="button" class="settings-field__clear" data-clear="apiKey" hidden>清除</button>
              </label>
              <input id="settings-apikey" class="settings-field__input" type="password" autocomplete="off" spellcheck="false" placeholder="sk-ant-…" />
            </div>
            <div class="settings-field">
              <label class="settings-field__label" for="settings-baseurl"><span>Base URL</span></label>
              <input id="settings-baseurl" class="settings-field__input" type="text" autocomplete="off" spellcheck="false" placeholder="留空走官方 api.anthropic.com" />
            </div>
            <div class="settings-field">
              <label class="settings-field__label" for="settings-model"><span>模型</span></label>
              <input id="settings-model" class="settings-field__input" type="text" autocomplete="off" spellcheck="false" placeholder="claude-sonnet-5" />
            </div>
          </section>
          <section class="settings-section">
            <h3 class="settings-section__title">访问令牌</h3>
            <p class="settings-section__hint">给 xdoc 自己加一道门。留空即不鉴权，能访问到的人都能读写文档。</p>
            <div class="settings-field">
              <label class="settings-field__label" for="settings-token">
                <span>Token</span>
                <button type="button" class="settings-field__clear" data-clear="token" hidden>清除</button>
              </label>
              <input id="settings-token" class="settings-field__input" type="password" autocomplete="off" spellcheck="false" placeholder="留空 = 不鉴权" />
            </div>
          </section>
        </div>

        <div class="settings-panel__body" id="settings-pane-mcp" data-pane="mcp" role="tabpanel" aria-labelledby="settings-tab-mcp" hidden>
          <section class="settings-section">
            <h3 class="settings-section__title">MCP 端点</h3>
            <p class="settings-section__hint">
              Agent 用这个地址调用 xdoc，读写的就是网页端这份文档——同一份空间，两边改动互相可见。
              没有额外进程，也无需先建什么。
            </p>
            <div class="settings-copy">
              <code data-mcp-url>—</code>
              <button type="button" class="settings-copy__btn" data-copy="url" title="复制端点地址">复制</button>
            </div>
            <p class="settings-section__hint" data-mcp-auth></p>
          </section>

          <section class="settings-section">
            <h3 class="settings-section__title">接入客户端</h3>
            <div class="settings-seg" role="tablist" aria-label="客户端">
              <button type="button" class="settings-seg__btn is-active" data-client="claude-code" role="tab" aria-selected="true">Claude Code</button>
              <button type="button" class="settings-seg__btn" data-client="opencode" role="tab" aria-selected="false">opencode</button>
            </div>

            <div data-client-pane="claude-code">
              <p class="settings-section__hint">一条命令加进去。默认只对当前项目生效，加 <code>--scope user</code> 则本机所有项目都能用。</p>
              <div class="settings-code">
                <pre><code data-snippet="claude-code-cmd"></code></pre>
                <button type="button" class="settings-copy__btn" data-copy="claude-code-cmd">复制</button>
              </div>
              <p class="settings-section__hint">或者手写项目根目录的 <code>.mcp.json</code>（团队共享的话提交上去）：</p>
              <div class="settings-code">
                <pre><code data-snippet="claude-code-json"></code></pre>
                <button type="button" class="settings-copy__btn" data-copy="claude-code-json">复制</button>
              </div>
            </div>

            <div data-client-pane="opencode" hidden>
              <p class="settings-section__hint">
                写进 <code>~/.config/opencode/opencode.json</code> 对全局生效，放项目根目录的
                <code>opencode.json</code> 则只对这个项目生效。
              </p>
              <div class="settings-code">
                <pre><code data-snippet="opencode-json"></code></pre>
                <button type="button" class="settings-copy__btn" data-copy="opencode-json">复制</button>
              </div>
            </div>
          </section>
        </div>

        <div class="settings-panel__foot" data-pane="settings">
          <span class="settings-status" role="status"></span>
          <button type="button" class="settings-save">保存</button>
        </div>
      </div>
    `;
    document.body.append(el);
    this.#modal = el;

    this.#apiKey = el.querySelector<HTMLInputElement>('#settings-apikey')!;
    this.#baseURL = el.querySelector<HTMLInputElement>('#settings-baseurl')!;
    this.#model = el.querySelector<HTMLInputElement>('#settings-model')!;
    this.#token = el.querySelector<HTMLInputElement>('#settings-token')!;
    this.#apiKeyClear = el.querySelector<HTMLButtonElement>('[data-clear="apiKey"]')!;
    this.#tokenClear = el.querySelector<HTMLButtonElement>('[data-clear="token"]')!;
    this.#source = el.querySelector<HTMLElement>('[data-source]')!;
    this.#status = el.querySelector<HTMLElement>('.settings-status')!;
    this.#saveBtn = el.querySelector<HTMLButtonElement>('.settings-save')!;
    this.#tabButtons = [...el.querySelectorAll<HTMLButtonElement>('.settings-tab')];
    this.#clientTabs = [...el.querySelectorAll<HTMLButtonElement>('.settings-seg__btn')];
    this.#mcpUrl = el.querySelector<HTMLElement>('[data-mcp-url]')!;
    this.#mcpAuth = el.querySelector<HTMLElement>('[data-mcp-auth]')!;

    el.querySelector('.settings-modal__backdrop')!.addEventListener('click', () => this.close());
    el.querySelector('.settings-panel__close')!.addEventListener('click', () => this.close());
    this.#apiKeyClear.addEventListener('click', () => this.#toggleClear('apiKey'));
    this.#tokenClear.addEventListener('click', () => this.#toggleClear('token'));
    this.#saveBtn.addEventListener('click', () => void this.#save());

    for (const button of this.#tabButtons) {
      button.addEventListener('click', () => this.#switchTab(button.dataset.tab as PanelTab));
    }
    for (const button of this.#clientTabs) {
      button.addEventListener('click', () => this.#switchClient(button.dataset.client as McpClient));
    }
    for (const button of el.querySelectorAll<HTMLButtonElement>('[data-copy]')) {
      button.addEventListener('click', () => this.#copy(button.dataset.copy as SnippetKey, button));
    }
    // 端点地址不依赖服务端，挂上就能显示；令牌相关的片段等 #load 回来再补
    this.#mcpUrl.textContent = this.#endpoint();

    // 面板里回车即保存
    for (const input of [this.#apiKey, this.#baseURL, this.#model, this.#token]) {
      input.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        void this.#save();
      });
    }
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') this.close();
    });
  }

  // ---------- 读写 ----------

  async #load(): Promise<void> {
    try {
      this.#apply(await fetchSettings());
    } catch (error) {
      this.#setStatus(`读取失败：${error instanceof Error ? error.message : String(error)}`, 'error');
    }
  }

  async #save(): Promise<void> {
    const patch: SettingsPatch = {
      ai: {
        // baseURL / 模型拿到的就是真值，输入框清空即代表清掉
        baseURL: this.#baseURL.value.trim(),
        model: this.#model.value.trim(),
      },
    };
    const apiKey = this.#apiKey.value.trim();
    if (apiKey) patch.ai!.apiKey = apiKey;
    else if (this.#cleared.has('apiKey')) patch.ai!.apiKey = '';

    const token = this.#token.value.trim();
    if (token) patch.token = token;
    else if (this.#cleared.has('token')) patch.token = '';

    this.#saveBtn.disabled = true;
    this.#setStatus('保存中…');
    try {
      this.#apply(await patchSettings(patch));
      // 令牌写进本机浏览器：否则刚设完，下一次请求就 401 弹回输入框
      if (patch.token !== undefined) setToken(patch.token);
      this.#setStatus(patch.token !== undefined ? '已保存，令牌已立即生效' : '已保存', 'ok');
    } catch (error) {
      this.#setStatus(`保存失败：${error instanceof Error ? error.message : String(error)}`, 'error');
    } finally {
      this.#saveBtn.disabled = false;
    }
  }

  /** 用服务端返回的样子刷新表单；密钥字段一律留空，只把掩码写进 placeholder */
  #apply(view: SettingsView): void {
    this.#view = view;
    this.#cleared.clear();

    this.#baseURL.value = view.ai.baseURL;
    this.#model.value = view.ai.model;

    this.#apiKey.value = '';
    this.#apiKey.placeholder = view.ai.apiKeyMask || 'sk-ant-…';
    this.#apiKeyClear.hidden = !view.ai.hasApiKey;
    this.#apiKeyClear.textContent = '清除';

    this.#token.value = '';
    this.#token.placeholder = view.token.tokenMask || '留空 = 不鉴权';
    this.#tokenClear.hidden = !view.token.hasToken;
    this.#tokenClear.textContent = '清除';

    // 没 key 就是不能用，这时别管配置写在哪儿，直接说缺什么
    this.#source.textContent = view.ai.hasApiKey ? SOURCE_HINT[view.ai.source] : SOURCE_HINT.none;

    this.#renderMcp(view);
  }

  // ---------- MCP 接入 ----------

  /** 端点地址：浏览器怎么访问到这个站，Agent 就怎么访问 */
  #endpoint(): string {
    return `${location.origin}/mcp`;
  }

  /**
   * 各客户端的接入片段。
   *
   * 令牌写占位符而不是真值：服务端只回掩码，片段又常被截图、投屏贴给别人，
   * 把真令牌印在屏幕上没什么好处。没开令牌的服务端则整段不带 Authorization——
   * 那种情况下带上反而会把人误导成「有鉴权」。
   */
  #buildSnippets(withToken: boolean): Map<SnippetKey, string> {
    const url = this.#endpoint();
    const authorization = 'Bearer <你的令牌>';
    const headers = withToken ? { Authorization: authorization } : undefined;
    const claudeCommand = withToken
      ? `claude mcp add --transport http xdoc ${url} --header "Authorization: ${authorization}"`
      : `claude mcp add --transport http xdoc ${url}`;

    return new Map<SnippetKey, string>([
      ['claude-code-cmd', claudeCommand],
      [
        'claude-code-json',
        `${JSON.stringify({ mcpServers: { xdoc: { type: 'http', url, ...(headers ? { headers } : {}) } } }, null, 2)}\n`,
      ],
      [
        'opencode-json',
        `${JSON.stringify(
          {
            $schema: 'https://opencode.ai/config.json',
            mcp: { xdoc: { type: 'remote', url, enabled: true, ...(headers ? { headers } : {}) } },
          },
          null,
          2,
        )}\n`,
      ],
    ]);
  }

  #renderMcp(view: SettingsView): void {
    this.#mcpUrl.textContent = this.#endpoint();
    this.#mcpAuth.textContent = view.token.hasToken
      ? '本站开了访问令牌，片段里的 <你的令牌> 要换成实际那串；忘了的话在「设置 → 访问令牌」里重设一个（旧令牌随即失效）。'
      : '本站没设访问令牌，能访问到这个地址的人都能读写文档，片段里不用带 Authorization。';

    this.#snippets = this.#buildSnippets(view.token.hasToken);
    for (const node of this.#modal!.querySelectorAll<HTMLElement>('[data-snippet]')) {
      node.textContent = this.#snippets.get(node.dataset.snippet as SnippetKey) ?? '';
    }
  }

  /** 切分区：只显示对应的 pane，底部那排「保存」跟着一起收起来 */
  #switchTab(tab: PanelTab): void {
    for (const node of this.#modal!.querySelectorAll<HTMLElement>('[data-pane]')) {
      node.hidden = node.dataset.pane !== tab;
    }
    for (const button of this.#tabButtons) {
      const active = button.dataset.tab === tab;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', String(active));
    }
  }

  /** 切客户端：Claude Code 与 opencode 各一套片段 */
  #switchClient(client: McpClient): void {
    for (const node of this.#modal!.querySelectorAll<HTMLElement>('[data-client-pane]')) {
      node.hidden = node.dataset.clientPane !== client;
    }
    for (const button of this.#clientTabs) {
      const active = button.dataset.client === client;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', String(active));
    }
  }

  #copy(key: SnippetKey, button: HTMLButtonElement): void {
    const text = key === 'url' ? this.#endpoint() : (this.#snippets.get(key) ?? '');
    if (!text) return;
    const flash = (label: string) => {
      button.textContent = label;
      button.classList.toggle('is-done', label === '已复制');
      window.setTimeout(() => {
        button.textContent = '复制';
        button.classList.remove('is-done');
      }, 1600);
    };

    // 明文 HTTP（非 localhost）不是安全上下文，navigator.clipboard 压根不存在，
    // 而 xdoc 常这么部署——退回到「选中文本自己按 Ctrl+C」，别让按钮点了没反应
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(
        () => flash('已复制'),
        () => this.#selectText(key, flash),
      );
      return;
    }
    this.#selectText(key, flash);
  }

  #selectText(key: SnippetKey, flash: (label: string) => void): void {
    const selector = key === 'url' ? '[data-mcp-url]' : `[data-snippet="${key}"]`;
    const node = this.#modal!.querySelector<HTMLElement>(selector);
    if (!node) return;
    const range = document.createRange();
    range.selectNodeContents(node);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    flash('已选中，按 Ctrl+C');
  }

  /** 「清除」是个开关：误点了能再点回来，不至于只能关掉面板重来 */
  #toggleClear(key: SecretField): void {
    const view = this.#view;
    if (!view) return;
    const input = key === 'apiKey' ? this.#apiKey : this.#token;
    const button = key === 'apiKey' ? this.#apiKeyClear : this.#tokenClear;
    const mask = key === 'apiKey' ? view.ai.apiKeyMask : view.token.tokenMask;

    if (this.#cleared.delete(key)) {
      input.value = '';
      input.placeholder = mask || '留空 = 不修改';
      button.textContent = '清除';
      return;
    }
    this.#cleared.add(key);
    input.value = '';
    input.placeholder = '保存后清除';
    button.textContent = '取消清除';
    input.focus();
  }

  #setStatus(message: string, kind: 'ok' | 'error' | null = null): void {
    this.#status.textContent = message;
    this.#status.classList.toggle('is-ok', kind === 'ok');
    this.#status.classList.toggle('is-error', kind === 'error');
  }
}

export const settingsPanel = new SettingsPanel();
