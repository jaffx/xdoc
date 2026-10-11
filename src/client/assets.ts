import { withToken, fetchAssets, uploadAsset, deleteAsset, type AssetInfo } from './api';

type AssetType = 'all' | 'image' | 'video' | 'audio';

export interface AssetsPanel {
  show: () => void;
  hide: () => void;
  refresh: () => Promise<void>;
  onInsert: ((path: string) => void) | null;
}

export function createAssetsPanel(spaceId: () => string | null): AssetsPanel {
  let modal: HTMLElement | null = null;
  let items: AssetInfo[] = [];
  let currentType: AssetType = 'all';
  let selectedPaths = new Set<string>();
  let multiSelectMode = false;
  let onInsert: ((path: string) => void) | null = null;

  function createModal(): HTMLElement {
    const el = document.createElement('div');
    el.id = 'assets-modal';
    el.className = 'assets-modal';
    el.innerHTML = `
      <div class="assets-modal__backdrop"></div>
      <div class="assets-modal__content">
        <div class="assets-modal__header">
          <h2>素材管理</h2>
          <button class="assets-modal__close" title="关闭">×</button>
        </div>
        <div class="assets-modal__toolbar">
          <div class="assets-tabs">
            <button class="assets-tab is-active" data-type="all">全部</button>
            <button class="assets-tab" data-type="image">图片</button>
            <button class="assets-tab" data-type="video">视频</button>
            <button class="assets-tab" data-type="audio">音频</button>
          </div>
          <div class="assets-toolbar__actions">
            <button class="assets-multi-toggle">多选</button>
            <button class="assets-batch-copy" disabled>复制已选 (<span class="assets-selection-count">0</span>)</button>
            <button class="assets-batch-delete" disabled>删除已选 (<span class="assets-selection-count">0</span>)</button>
            <button class="assets-upload-btn">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="17 8 12 3 7 8"/>
                <line x1="12" y1="3" x2="12" y2="15"/>
              </svg>
              上传素材
            </button>
          </div>
        </div>
        <div class="assets-modal__body">
          <div class="assets-grid"></div>
          <div class="assets-empty" hidden>暂无素材</div>
        </div>
      </div>
    `;

    // 关闭按钮
    el.querySelector('.assets-modal__backdrop')?.addEventListener('click', hide);
    el.querySelector('.assets-modal__close')?.addEventListener('click', hide);

    // 多选切换
    const multiToggle = el.querySelector('.assets-multi-toggle') as HTMLButtonElement;
    multiToggle.addEventListener('click', () => {
      multiSelectMode = !multiSelectMode;
      multiToggle.classList.toggle('is-active', multiSelectMode);
      multiToggle.textContent = multiSelectMode ? '取消多选' : '多选';
      
      if (!multiSelectMode) {
        selectedPaths.clear();
      }
      renderGrid();
      updateSelectionUI();
    });

    // 批量复制
    const batchCopyBtn = el.querySelector('.assets-batch-copy') as HTMLButtonElement;
    batchCopyBtn.addEventListener('click', () => {
      if (selectedPaths.size === 0) return;
      
      // 把所有路径合并成一个字符串，每行一个
      const paths = Array.from(selectedPaths);
      const allSyntax = paths.map(p => `:::asset path="${p}" :::`).join('\n');
      
      // 调用一次 onInsert，传入所有内容
      onInsert?.(allSyntax);
      
      selectedPaths.clear();
      multiSelectMode = false;
      multiToggle.classList.remove('is-active');
      multiToggle.textContent = '多选';
      renderGrid();
      updateSelectionUI();
      // 不关闭，让用户继续操作
    });

    // 批量删除
    const batchDeleteBtn = el.querySelector('.assets-batch-delete') as HTMLButtonElement;
    batchDeleteBtn.addEventListener('click', async () => {
      if (selectedPaths.size === 0) return;
      if (!confirm(`确定删除 ${selectedPaths.size} 个素材吗？`)) return;
      
      const sid = spaceId();
      if (!sid) return;
      
      for (const path of selectedPaths) {
        try {
          await deleteAsset(sid, path);
        } catch (error) {
          console.error(`删除 ${path} 失败:`, error);
        }
      }
      
      selectedPaths.clear();
      await refresh();
      updateSelectionUI();
    });

    // Tab 切换
    const tabs = el.querySelectorAll('.assets-tab');
    tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        tabs.forEach((t) => t.classList.remove('is-active'));
        tab.classList.add('is-active');
        currentType = (tab as HTMLElement).dataset.type as AssetType;
        renderGrid();
      });
    });

    // 上传按钮
    const uploadBtn = el.querySelector('.assets-upload-btn') as HTMLButtonElement;
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.multiple = true;
    fileInput.style.display = 'none';
    el.appendChild(fileInput);

    uploadBtn.addEventListener('click', () => {
      const acceptMap: Record<AssetType, string> = {
        all: 'image/*,video/*,audio/*',
        image: 'image/*',
        video: 'video/*',
        audio: 'audio/*',
      };
      fileInput.accept = acceptMap[currentType];
      fileInput.click();
    });

    fileInput.addEventListener('change', async () => {
      if (!fileInput.files || fileInput.files.length === 0) return;
      
      const files = Array.from(fileInput.files);
      const uploadBtn = modal?.querySelector('.assets-upload-btn') as HTMLButtonElement;
      if (uploadBtn) {
        uploadBtn.disabled = true;
        uploadBtn.textContent = `上传中 (0/${files.length})...`;
      }
      
      let uploaded = 0;
      for (const file of files) {
        try {
          await handleUpload(file);
          uploaded++;
          if (uploadBtn) {
            uploadBtn.textContent = `上传中 (${uploaded}/${files.length})...`;
          }
        } catch (error) {
          console.error('上传失败:', file.name, error);
        }
      }
      
      if (uploadBtn) {
        uploadBtn.disabled = false;
        uploadBtn.innerHTML = `
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="17 8 12 3 7 8"/>
            <line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
          上传素材
        `;
      }
      
      fileInput.value = '';
      await refresh();
    });

    // 拖拽上传
    const content = el.querySelector('.assets-modal__content') as HTMLElement;
    content.addEventListener('dragover', (e) => {
      e.preventDefault();
      content.classList.add('is-dragover');
    });
    content.addEventListener('dragleave', (e) => {
      if (!content.contains(e.relatedTarget as Node)) {
        content.classList.remove('is-dragover');
      }
    });
    content.addEventListener('drop', async (e) => {
      e.preventDefault();
      content.classList.remove('is-dragover');
      const files = e.dataTransfer?.files;
      if (!files) return;
      for (const file of Array.from(files)) {
        if (!isFileTypeAllowed(file.type, currentType)) {
          alert(`文件 "${file.name}" 类型不允许`);
          continue;
        }
        await handleUpload(file);
      }
    });

    // Esc 关闭
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !el.hidden) hide();
    });

    return el;
  }

  async function handleUpload(file: File): Promise<boolean> {
    const sid = spaceId();
    if (!sid) return false;
    
    if (!isFileTypeAllowed(file.type, currentType)) {
      alert(`文件 "${file.name}" 类型不允许`);
      return false;
    }
    
    try {
      await uploadAsset(sid, file);
      return true;
    } catch (error) {
      alert(`上传失败: ${file.name} - ${error instanceof Error ? error.message : error}`);
      return false;
    }
  }

  function isFileTypeAllowed(mimeType: string, type: AssetType): boolean {
    if (type === 'all') return /^(image|video|audio)\//.test(mimeType);
    return mimeType.startsWith(`${type}/`);
  }

  function filterByType(items: AssetInfo[], type: AssetType): AssetInfo[] {
    if (type === 'all') return items;
    return items.filter((item) => item.mimeType.startsWith(`${type}/`));
  }

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function getIcon(mimeType: string): string {
    if (mimeType.startsWith('video/')) return '🎬';
    if (mimeType.startsWith('audio/')) return '🎵';
    return '📄';
  }

  function renderGrid(): void {
    if (!modal) return;
    const grid = modal.querySelector('.assets-grid') as HTMLElement;
    const empty = modal.querySelector('.assets-empty') as HTMLElement;

    const filtered = filterByType(items, currentType);

    if (filtered.length === 0) {
      grid.innerHTML = '';
      empty.hidden = false;
      empty.textContent = '暂无素材，点击上传或拖拽文件到这里';
      return;
    }

    empty.hidden = true;
    grid.innerHTML = filtered
      .map((item) => {
        const isImage = item.mimeType.startsWith('image/');
        const isSelected = selectedPaths.has(item.path);
        const thumb = isImage
          ? `<img src="${withToken(`/api/assets/file?space=${encodeURIComponent(spaceId() ?? '')}&path=${encodeURIComponent(item.path)}`)}" alt="${item.name}" />`
          : `<div class="assets-icon">${getIcon(item.mimeType)}</div>`;

        return `
          <div class="assets-item ${isSelected ? 'is-selected' : ''}" data-path="${item.path}">
            ${multiSelectMode ? `<div class="assets-checkbox ${isSelected ? 'is-checked' : ''}">${isSelected ? '✓' : ''}</div>` : ''}
            <div class="assets-thumb">${thumb}</div>
            <div class="assets-info">
              <div class="assets-name" title="${item.name}">${item.name}</div>
              <div class="assets-size">${formatSize(item.size)}</div>
            </div>
            ${!multiSelectMode ? `<div class="assets-actions"><button class="assets-copy">复制</button></div>` : ''}
          </div>
        `;
      })
      .join('');

    // 绑定点击事件
    grid.querySelectorAll('.assets-item').forEach((el) => {
      const path = (el as HTMLElement).dataset.path!;
      
      el.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('.assets-actions')) return;
        
        if (multiSelectMode) {
          // 多选模式：切换选中
          if (selectedPaths.has(path)) {
            selectedPaths.delete(path);
          } else {
            selectedPaths.add(path);
          }
          renderGrid();
          updateSelectionUI();
        } else {
          // 单选模式：复制素材名
          onInsert?.(path);
        }
      });
      
      // 复制按钮
      el.querySelector('.assets-copy')?.addEventListener('click', (e) => {
        e.stopPropagation();
        onInsert?.(path);
      });
    });
  }

  function updateSelectionUI(): void {
    if (!modal) return;
    const count = selectedPaths.size;
    const countEls = modal.querySelectorAll('.assets-selection-count');
    const batchCopyBtn = modal.querySelector('.assets-batch-copy') as HTMLButtonElement;
    const batchDeleteBtn = modal.querySelector('.assets-batch-delete') as HTMLButtonElement;
    
    countEls.forEach((el) => { el.textContent = String(count); });
    if (batchCopyBtn) batchCopyBtn.disabled = count === 0;
    if (batchDeleteBtn) batchDeleteBtn.disabled = count === 0;
  }

  async function refresh(): Promise<void> {
    const sid = spaceId();
    if (!sid) {
      items = [];
      renderGrid();
      return;
    }
    try {
      const result = await fetchAssets(sid);
      items = result.items;
      renderGrid();
    } catch (error) {
      console.error('加载素材失败:', error);
      items = [];
      renderGrid();
    }
  }

  function show(): void {
    if (!modal) {
      modal = createModal();
      document.body.appendChild(modal);
    }
    modal.hidden = false;
    document.body.classList.add('is-modal-open');
    void refresh();
  }

  function hide(): void {
    if (modal) {
      modal.hidden = true;
      document.body.classList.remove('is-modal-open');
    }
  }

  return {
    show,
    hide,
    refresh,
    get onInsert() { return onInsert; },
    set onInsert(handler: ((path: string) => void) | null) { onInsert = handler; },
  };
}
