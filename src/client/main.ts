import {
  addSpace,
  AuthError,
  createDoc,
  createFolder,
  deleteEntry,
  fetchDoc,
  fetchEmbeds,
  fetchSpaces,
  fetchStyles,
  fetchTree,
  removeSpace,
  renameEntry,
  setToken,
  updateSpace,
  verifyToken,
  withToken,
  type DocPayload,
  type SpaceInfo,
  type TreeNode,
} from './api';
import { renderDiagrams } from './diagram';

const $ = <T extends Element = HTMLElement>(selector: string) => document.querySelector(selector) as T;

const els = {
  tree: $('#tree'),
  content: $('#content'),
  toc: $('#toc'),
  search: $('#search') as HTMLInputElement,
  crumb: $('#crumb'),
  status: $('#status'),
  exportBtn: $('#export-btn') as HTMLButtonElement,
  scroller: $('#scroller'),
  toast: $('#toast'),
  themeToggle: $('#theme-toggle'),
  menuToggle: $('#menu-toggle'),
  backdrop: $('#sidebar-backdrop'),
  sidebar: $('#sidebar'),
  customStyles: $('#custom-styles'),
  embedCount: $('#embed-count'),
  treeToolbar: $('#tree-toolbar'),
  spaceSwitch: $('#space-switch'),
  spaceBtn: $('#space-btn'),
  spaceBtnName: $('#space-btn-name'),
  spaceMenu: $('#space-menu'),
  spaceList: $('#space-list'),
  spaceCreateToggle: $('#space-create-toggle'),
  spaceEdit: $('#space-edit') as HTMLFormElement,
  spaceEditName: $('#space-edit-name') as HTMLInputElement,
  spaceEditDesc: $('#space-edit-desc') as HTMLTextAreaElement,
  spaceEditCancel: $('#space-edit-cancel'),
  spaceCreate: $('#space-create') as HTMLFormElement,
  spaceCreateName: $('#space-create-name') as HTMLInputElement,
  spaceCreateDesc: $('#space-create-desc') as HTMLTextAreaElement,
  spaceCreateCancel: $('#space-create-cancel'),
  newFile: $('#new-file'),
  newFolder: $('#new-folder'),
  gate: $('#gate'),
  gateForm: $('#gate-form') as HTMLFormElement,
  gateInput: $('#gate-input') as HTMLInputElement,
  gateError: $('#gate-error'),
  gateSubmit: $('#gate-submit') as HTMLButtonElement,
};

const SPACE_KEY = 'xdoc:space';
const LAST_DOC_KEY = 'xdoc:lastDocs';
const SIDEBAR_KEY = 'xdoc:sidebar';
const TOC_KEY = 'xdoc:toc';

const TOC_CARET_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';

const CARET_SVG =
  '<svg class="tree__caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>';
const FOLDER_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>';
const FOLDER_OPEN_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="m6 14 1.45-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/></svg>';
const FILE_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/></svg>';

/** 顶部面包屑：按层级拆段，末段高亮，整体路径放进 title 供截断时查看 */
function setCrumb(parts: string[]) {
  const segments = parts.filter((part) => part && part !== '/');
  els.crumb.innerHTML = '';
  els.crumb.title = segments.join(' / ');
  segments.forEach((part, index) => {
    if (index > 0) {
      const sep = document.createElement('span');
      sep.className = 'crumb__sep';
      sep.textContent = '/';
      els.crumb.append(sep);
    }
    const segment = document.createElement('span');
    segment.className = `crumb__seg${index === segments.length - 1 ? ' is-current' : ''}`;
    segment.textContent = part;
    els.crumb.append(segment);
  });
}
const ANCHOR_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg>';
const COPY_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>';
const DONE_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';
const TRASH_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/><path d="M6 7l1 13h10l1-13"/><path d="M10 11v5M14 11v5"/></svg>';

const EDIT_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4z"/><path d="m14 6 4 4"/></svg>';
const FILE_PLUS_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M12 12v6M9 15h6"/></svg>';
const FOLDER_PLUS_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/><path d="M12 11v6M9 14h6"/></svg>';

let spaces: SpaceInfo[] = [];
let spaceId: string | null = null;
let tree: TreeNode[] = [];
const treeCache = new Map<string, TreeNode[]>();
let current: string | null = null;
let tocObserver: IntersectionObserver | null = null;
let tocToggle: HTMLButtonElement | null = null;
let editingSpaceId: string | null = null;

// ---------- 工具 ----------

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] as string);
}

function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function resolveRelative(fromDoc: string, href: string): string {
  const [pathPart] = href.split(/[?#]/);
  const segments = pathPart.startsWith('/')
    ? pathPart.split('/')
    : [...fromDoc.split('/').slice(0, -1), ...pathPart.split('/')];
  const out: string[] = [];
  for (const segment of segments) {
    if (!segment || segment === '.') continue;
    if (segment === '..') out.pop();
    else out.push(segment);
  }
  return out.join('/');
}

function spaceName(id: string | null): string {
  return spaces.find((space) => space.id === id)?.name ?? '';
}

function docHash(space: string, doc: string | null): string {
  return `#/${space}${doc ? `/${encodePath(doc)}` : ''}`;
}

// ---------- 记忆（localStorage） ----------

function rememberedSpace(): string {
  const saved = localStorage.getItem(SPACE_KEY);
  if (saved && spaces.some((space) => space.id === saved)) return saved;
  return spaces[0].id;
}

function lastDocMap(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(LAST_DOC_KEY) ?? '{}') as Record<string, string>;
  } catch {
    return {};
  }
}

function lastDocFor(id: string): string | null {
  return lastDocMap()[id] ?? null;
}

function saveLastDoc(id: string, doc: string) {
  const map = lastDocMap();
  map[id] = doc;
  localStorage.setItem(LAST_DOC_KEY, JSON.stringify(map));
}

// ---------- 主题 ----------

function initTheme() {
  const saved = localStorage.getItem('xdoc-theme');
  if (saved) document.documentElement.dataset.theme = saved;
  els.themeToggle.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('xdoc-theme', next);
    // 图表主题在渲染时固定，切主题后按新主题重绘
    renderDiagrams(els.content);
  });
}

// ---------- 面板收起 ----------

/** 与 styles.css 的响应式断点保持一致：窄屏侧栏是遮罩抽屉，宽屏才是可折叠的一栏 */
const MOBILE_QUERY = '(max-width: 900px)';

function initSidebar() {
  const collapsed = localStorage.getItem(SIDEBAR_KEY) === 'collapsed';
  document.body.classList.toggle('is-sidebar-collapsed', collapsed);
  els.menuToggle.setAttribute('aria-expanded', String(!collapsed));

  els.menuToggle.addEventListener('click', () => {
    if (window.matchMedia(MOBILE_QUERY).matches) {
      if (els.sidebar.classList.contains('is-open')) closeSidebar();
      else openSidebar();
      return;
    }
    const next = document.body.classList.toggle('is-sidebar-collapsed');
    localStorage.setItem(SIDEBAR_KEY, next ? 'collapsed' : 'expanded');
    els.menuToggle.setAttribute('aria-expanded', String(!next));
  });
  els.backdrop.addEventListener('click', closeSidebar);
}

// ---------- 提示 ----------

let toastTimer: number | undefined;
function toast(message: string, kind: 'info' | 'error' = 'info') {
  els.toast.textContent = message;
  els.toast.dataset.kind = kind;
  els.toast.classList.add('is-visible');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => els.toast.classList.remove('is-visible'), 2600);
}

// ---------- 空间切换器 ----------

function renderSpaces() {
  const active = spaces.find((space) => space.id === spaceId);
  els.spaceBtnName.textContent = active?.name ?? '选择空间';

  els.spaceList.innerHTML = '';
  for (const space of spaces) {
    const row = document.createElement('div');
    row.className = `space-item${space.id === spaceId ? ' is-active' : ''}`;

    const main = document.createElement('button');
    main.type = 'button';
    main.className = 'space-item__main';
    main.title = space.description ? `${space.name}\n${space.description}` : space.name;
    main.innerHTML = `<span class="space-item__name">${escapeHtml(space.name)}</span>${space.description ? `<span class="space-item__sub is-desc">${escapeHtml(space.description)}</span>` : ''}`;
    main.addEventListener('click', () => {
      closeSpaceMenu();
      if (space.id !== spaceId) location.hash = docHash(space.id, null);
    });
    row.append(main);

    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'space-item__edit';
    edit.title = '编辑名称与备注';
    edit.setAttribute('aria-label', `编辑空间 ${space.name}`);
    edit.innerHTML = EDIT_SVG;
    edit.addEventListener('click', (event) => {
      event.stopPropagation();
      openEditForm(space);
    });
    row.append(edit);

    if (spaces.length > 1) {
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'space-item__remove';
      remove.title = `移除空间「${space.name}」`;
      remove.setAttribute('aria-label', `移除空间 ${space.name}`);
      remove.innerHTML = TRASH_SVG;
      remove.addEventListener('click', async (event) => {
        event.stopPropagation();
        try {
          await removeSpace(space.id);
          await reloadSpaces();
          toast(`已移除空间「${space.name}」`);
          if (space.id === spaceId) {
            history.replaceState(null, '', location.pathname);
            await route();
          }
        } catch (error) {
          reportError(error);
        }
      });
      row.append(remove);
    }
    els.spaceList.append(row);
  }
}

function openEditForm(space: SpaceInfo) {
  editingSpaceId = space.id;
  els.spaceCreate.hidden = true;
  els.spaceEditName.value = space.name;
  els.spaceEditDesc.value = space.description ?? '';
  els.spaceEdit.hidden = false;
  els.spaceEditName.focus();
  els.spaceEditName.select();
}

function closeEditForm() {
  editingSpaceId = null;
  els.spaceEdit.hidden = true;
}

function openCreateForm() {
  closeEditForm();
  els.spaceCreate.hidden = false;
  els.spaceCreateName.value = '';
  els.spaceCreateDesc.value = '';
  els.spaceCreateName.focus();
}

function closeCreateForm() {
  els.spaceCreate.hidden = true;
}

async function submitEditForm() {
  if (!editingSpaceId) return;
  try {
    const updated = await updateSpace(editingSpaceId, {
      name: els.spaceEditName.value.trim(),
      description: els.spaceEditDesc.value,
    });
    closeEditForm();
    await reloadSpaces();
    if (updated.id === spaceId && current) setCrumb([updated.name, ...current.split('/')]);
    toast(`已更新空间「${updated.name}」`);
  } catch (error) {
    reportError(error);
  }
}

async function submitCreateForm() {
  const name = els.spaceCreateName.value.trim();
  if (!name) {
    toast('请填写空间名称', 'error');
    return;
  }
  try {
    const { space, created } = await addSpace({
      name,
      description: els.spaceCreateDesc.value.trim() || undefined,
    });
    closeSpaceMenu();
    await reloadSpaces();
    if (space.id !== spaceId) location.hash = docHash(space.id, null);
    toast(created ? `已创建空间「${space.name}」` : `空间已存在：${space.name}`);
  } catch (error) {
    reportError(error);
  }
}

function openSpaceMenu() {
  els.spaceMenu.hidden = false;
  els.spaceBtn.setAttribute('aria-expanded', 'true');
  els.spaceCreateToggle.focus();
}

function closeSpaceMenu() {
  els.spaceMenu.hidden = true;
  els.spaceBtn.setAttribute('aria-expanded', 'false');
  closeEditForm();
  closeCreateForm();
}

async function reloadSpaces() {
  spaces = await fetchSpaces();
  if (editingSpaceId && !spaces.some((space) => space.id === editingSpaceId)) closeEditForm();
  renderSpaces();
}

// ---------- 目录树 ----------

const dirItems = new Map<string, HTMLElement>();
const dirLists = new Map<string, HTMLElement>();
let pendingInput: { row: HTMLElement; input: HTMLInputElement } | null = null;

function buildList(nodes: TreeNode[]): HTMLElement {
  const list = document.createElement('ul');
  list.className = 'tree__list';
  for (const node of nodes) list.append(buildNode(node));
  return list;
}

function buildNode(node: TreeNode): HTMLElement {
  const item = document.createElement('li');
  item.dataset.path = node.path;
  const row = document.createElement('div');
  row.className = 'tree__row';

  if (node.type === 'dir') {
    item.className = 'tree__dir';
    dirItems.set(node.path, item);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tree__dir-btn';
    button.innerHTML = `${CARET_SVG}<span class="tree__icon tree__icon--folder">${FOLDER_SVG}</span><span class="tree__icon tree__icon--folder-open">${FOLDER_OPEN_SVG}</span><span class="tree__label">${escapeHtml(node.name)}</span>`;
    button.addEventListener('click', () => item.classList.toggle('is-collapsed'));
    row.append(button, buildActions(node));
    const children = buildList(node.children ?? []);
    dirLists.set(node.path, children);
    item.append(row, children);
  } else {
    item.className = 'tree__file';
    const link = document.createElement('a');
    link.href = docHash(spaceId ?? '', node.path);
    const label = node.name.replace(/\.(md|markdown)$/i, '');
    // 标签原文存在 dataset 上，搜索时按它做高亮（hint：filterTree）
    item.dataset.label = label;
    link.innerHTML = `<span class="tree__icon tree__icon--file">${FILE_SVG}</span><span class="tree__label">${escapeHtml(label)}</span>`;
    row.append(link, buildActions(node));
    item.append(row);
  }
  return item;
}

function buildActions(node: TreeNode): HTMLElement {
  const actions = document.createElement('span');
  actions.className = 'tree__actions';
  if (node.type === 'dir') {
    actions.append(
      treeActionButton('新建文件', FILE_PLUS_SVG, () => beginCreate(node.path, 'file')),
      treeActionButton('新建文件夹', FOLDER_PLUS_SVG, () => beginCreate(node.path, 'folder')),
    );
  }
  actions.append(
    treeActionButton('重命名', EDIT_SVG, () => beginRename(node)),
    treeActionButton('删除', TRASH_SVG, () => void deleteNode(node), true),
  );
  return actions;
}

function treeActionButton(title: string, svg: string, onClick: () => void, danger = false): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `tree-act${danger ? ' is-danger' : ''}`;
  button.title = title;
  button.setAttribute('aria-label', title);
  button.innerHTML = svg;
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    onClick();
  });
  return button;
}

function cancelPendingInput() {
  if (!pendingInput) return;
  pendingInput.row.remove();
  pendingInput = null;
}

interface InlineInputOptions {
  container: HTMLElement;
  placeholder: string;
  initial?: string;
  onSubmit: (value: string) => Promise<boolean>;
}

function showInlineInput({ container, placeholder, initial, onSubmit }: InlineInputOptions) {
  cancelPendingInput();
  const row = document.createElement('li');
  row.className = 'tree__input';
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = placeholder;
  input.value = initial ?? '';
  input.autocomplete = 'off';
  input.spellcheck = false;
  row.append(input);
  container.prepend(row);
  input.focus();
  input.select();
  pendingInput = { row, input };

  let busy = false;
  const finish = () => {
    if (pendingInput?.input === input) pendingInput = null;
    row.remove();
  };
  const submit = async () => {
    if (busy) return;
    const value = input.value.trim();
    if (!value) {
      finish();
      return;
    }
    busy = true;
    input.disabled = true;
    const ok = await onSubmit(value);
    busy = false;
    if (ok) finish();
    else {
      input.disabled = false;
      input.focus();
    }
  };
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void submit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      finish();
    }
  });
  input.addEventListener('blur', () => {
    if (busy) return;
    if (input.value.trim()) void submit();
    else finish();
  });
}

function parentOf(rel: string): string {
  const index = rel.lastIndexOf('/');
  return index === -1 ? '' : rel.slice(0, index);
}

function beginCreate(parentPath: string | null, kind: 'file' | 'folder') {
  const container = parentPath === null ? els.tree.querySelector<HTMLElement>('.tree__list') : dirLists.get(parentPath);
  if (!container) return;
  if (parentPath !== null) dirItems.get(parentPath)?.classList.remove('is-collapsed');
  showInlineInput({
    container,
    placeholder: kind === 'file' ? '文件名（自动补 .md）' : '文件夹名',
    onSubmit: async (name) => {
      if (!spaceId) return false;
      const target = parentPath ? `${parentPath}/${name}` : name;
      try {
        if (kind === 'file') {
          const { path } = await createDoc(spaceId, target);
          await refreshTree();
          if (path) location.hash = docHash(spaceId, path);
          toast(`已创建 ${path}`);
        } else {
          const { path } = await createFolder(spaceId, target);
          await refreshTree();
          toast(`已创建文件夹 ${path}`);
        }
        return true;
      } catch (error) {
        reportError(error);
        return false;
      }
    },
  });
}

function beginRename(node: TreeNode) {
  const item = [...els.tree.querySelectorAll<HTMLElement>('.tree__dir, .tree__file')].find(
    (element) => element.dataset.path === node.path,
  );
  if (!item) return;
  cancelPendingInput();
  const row = item.querySelector<HTMLElement>(':scope > .tree__row');
  if (!row) return;
  const previous = row.innerHTML;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'tree__input-inline';
  input.value = node.name;
  input.autocomplete = 'off';
  input.spellcheck = false;
  row.innerHTML = '';
  row.append(input);
  input.focus();
  input.select();
  pendingInput = { row, input };

  let busy = false;
  const restore = () => {
    if (pendingInput?.input === input) pendingInput = null;
    row.innerHTML = previous;
  };
  const submit = async () => {
    if (busy) return;
    const name = input.value.trim();
    if (!name || name === node.name) {
      restore();
      return;
    }
    if (!spaceId) return;
    busy = true;
    input.disabled = true;
    try {
      const target = parentOf(node.path) ? `${parentOf(node.path)}/${name}` : name;
      const { path } = await renameEntry(spaceId, node.path, target);
      if (current) {
        if (current === node.path) {
          current = path;
          saveLastDoc(spaceId, path);
          syncHash();
        } else if (node.type === 'dir' && current.startsWith(`${node.path}/`)) {
          current = `${path}${current.slice(node.path.length)}`;
          saveLastDoc(spaceId, current);
          syncHash();
          setCrumb([spaceName(spaceId), ...current.split('/')]);
        }
      }
      pendingInput = null;
      await refreshTree();
      toast(`已重命名为 ${path}`);
    } catch (error) {
      busy = false;
      input.disabled = false;
      input.focus();
      reportError(error);
    }
  };
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void submit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      restore();
    }
  });
  input.addEventListener('blur', () => {
    if (busy) return;
    if (input.value.trim() && input.value.trim() !== node.name) void submit();
    else restore();
  });
}

async function deleteNode(node: TreeNode) {
  if (!spaceId) return;
  const label = node.type === 'dir' ? `文件夹「${node.name}」及其中的内容` : `文件「${node.name}」`;
  if (!window.confirm(`确定删除${label}吗？此操作不可撤销。`)) return;
  try {
    await deleteEntry(spaceId, node.path, node.type === 'dir');
    const affected = current !== null && (current === node.path || current.startsWith(`${node.path}/`));
    if (affected) {
      current = null;
      history.replaceState(null, '', location.pathname);
    }
    await refreshTree();
    if (affected) await route();
    toast('已删除');
  } catch (error) {
    reportError(error);
  }
}

async function refreshTree() {
  if (!spaceId) return;
  tree = await loadTree(spaceId, true);
  renderTree();
  filterTree(els.search.value);
}

function renderTree() {
  cancelPendingInput();
  dirItems.clear();
  dirLists.clear();
  els.treeToolbar.hidden = false;
  els.tree.innerHTML = '';
  els.tree.append(buildList(tree));
  markActive();
}

function markActive() {
  for (const link of els.tree.querySelectorAll<HTMLAnchorElement>('.tree__file a')) {
    const item = link.closest<HTMLElement>('.tree__file');
    const active = item?.dataset.path === current;
    item?.classList.toggle('is-active', active);
    if (active) {
      let parent = item?.parentElement?.closest<HTMLElement>('.tree__dir');
      while (parent) {
        parent.classList.remove('is-collapsed');
        parent = parent.parentElement?.closest<HTMLElement>('.tree__dir') ?? null;
      }
      link.scrollIntoView({ block: 'nearest' });
    }
  }
}

/** 把标签里命中查询的片段包成 <mark>；query 为空则还原为纯文本 */
function highlightLabel(file: HTMLElement, query: string) {
  const labelEl = file.querySelector<HTMLElement>('.tree__label');
  if (!labelEl) return;
  const label = file.dataset.label ?? '';
  const needle = query.toLowerCase();
  if (!needle) {
    labelEl.textContent = label;
    return;
  }
  const haystack = label.toLowerCase();
  let html = '';
  let from = 0;
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, from)) {
    html += escapeHtml(label.slice(from, at));
    html += `<mark>${escapeHtml(label.slice(at, at + needle.length))}</mark>`;
    from = at + needle.length;
  }
  labelEl.innerHTML = html + escapeHtml(label.slice(from));
}

function filterTree(query: string) {
  const raw = query.trim();
  const q = raw.toLowerCase();
  for (const file of els.tree.querySelectorAll<HTMLElement>('.tree__file')) {
    const matched = q.length === 0 || (file.dataset.path ?? '').toLowerCase().includes(q);
    file.classList.toggle('is-hidden', !matched);
    highlightLabel(file, matched ? raw : '');
  }
  const dirs = [...els.tree.querySelectorAll<HTMLElement>('.tree__dir')].reverse();
  for (const dir of dirs) {
    const hasVisible = [...dir.querySelectorAll<HTMLElement>('.tree__file')].some((f) => !f.classList.contains('is-hidden'));
    dir.classList.toggle('is-hidden', q.length > 0 && !hasVisible);
    if (q.length > 0 && hasVisible) dir.classList.remove('is-collapsed');
  }
}

async function loadTree(id: string, force = false): Promise<TreeNode[]> {
  const cached = treeCache.get(id);
  if (!force && cached) return cached;
  const data = await fetchTree(id);
  treeCache.set(id, data);
  return data;
}

// ---------- 路由 ----------

function parseHash(): { space: string | null; doc: string | null } {
  const raw = location.hash.replace(/^#\/?/, '');
  if (!raw) return { space: null, doc: null };
  const segments = raw.split('/').map(decodeSegment);
  const maybeSpace = segments[0];
  if (spaces.some((space) => space.id === maybeSpace)) {
    const doc = segments.slice(1).join('/');
    return { space: maybeSpace, doc: doc || null };
  }
  // 兼容不含空间 id 的旧链接
  return { space: null, doc: segments.join('/') };
}

function findDefaultDoc(nodes: TreeNode[]): string | null {
  const files: string[] = [];
  const walk = (list: TreeNode[]) => {
    for (const node of list) {
      if (node.type === 'dir') walk(node.children ?? []);
      else files.push(node.path);
    }
  };
  walk(nodes);
  return files.find((file) => /(^|\/)(index|readme)\.(md|markdown)$/i.test(file)) ?? files[0] ?? null;
}

function showEmptySpaces() {
  current = null;
  // 没有空间时「新建文件 / 新建文件夹」无处可放，点了也只会静默失败，索性收起来
  els.treeToolbar.hidden = true;
  els.tree.innerHTML = '';
  els.content.innerHTML = '<div class="empty"><h1>还没有空间</h1><p>点左上角的「选择空间」→「新建空间」，建一个就能开始写文档。</p></div>';
  els.exportBtn.hidden = true;
  setCrumb(['首页']);
  renderSpaces();
}

async function route() {
  if (spaces.length === 0) {
    showEmptySpaces();
    return;
  }

  const parsed = parseHash();
  const targetSpace = parsed.space ?? rememberedSpace();

  if (targetSpace !== spaceId) {
    spaceId = targetSpace;
    localStorage.setItem(SPACE_KEY, spaceId);
    current = null;
    tree = await loadTree(spaceId);
    renderTree();
    filterTree(els.search.value);
    renderSpaces();
    void reloadStyles();
    void loadEmbeds();
  }

  const rememberedDoc = parsed.doc === null;
  const doc = parsed.doc ?? lastDocFor(spaceId);
  if (doc) {
    if (doc !== current) {
      const ok = await openDoc(doc);
      if (!ok && rememberedDoc) {
        const fallback = findDefaultDoc(tree);
        if (fallback && fallback !== doc) await openDoc(fallback);
      }
    } else {
      syncHash();
    }
  } else {
    const fallback = findDefaultDoc(tree);
    if (fallback) await openDoc(fallback);
    else {
      current = null;
      els.content.innerHTML = '<div class="empty"><h1>该空间没有 markdown 文件</h1><p>请放入 .md 文件，或在左上角切换到其他空间。</p></div>';
      els.exportBtn.hidden = true;
      setCrumb([spaceName(spaceId)]);
      syncHash();
    }
  }
}

function syncHash() {
  if (!spaceId) return;
  const target = docHash(spaceId, current);
  if (location.hash !== target) history.replaceState(null, '', target);
}

// ---------- 文档加载与渲染 ----------

async function openDoc(rel: string): Promise<boolean> {
  if (!spaceId) return false;
  const id = spaceId;
  current = rel;
  saveLastDoc(id, rel);
  syncHash();
  setCrumb([spaceName(id), ...rel.split('/')]);
  els.status.textContent = '加载中…';
  markActive();
  closeSidebar();
  try {
    const doc = await fetchDoc(id, rel);
    if (current !== rel || spaceId !== id) return false;
    renderDoc(doc);
    document.title = `${doc.title || rel} · xdoc`;
    els.status.textContent = '';
    return true;
  } catch (error) {
    if (current !== rel || spaceId !== id) return false;
    els.status.textContent = '';
    els.exportBtn.hidden = true;
    if (error instanceof AuthError) {
      showGate(error.message);
      return false;
    }
    els.content.innerHTML = `<div class="empty"><h1>加载失败</h1><p>${escapeHtml(String(error instanceof Error ? error.message : error))}</p></div>`;
    return false;
  }
}

async function refreshCurrent(keepScroll = true) {
  if (!spaceId || !current) return;
  const id = spaceId;
  const rel = current;
  try {
    const doc = await fetchDoc(id, rel);
    if (spaceId !== id || current !== rel) return;
    renderDoc(doc, keepScroll);
  } catch (error) {
    reportError(error);
  }
}

function renderDoc(doc: DocPayload, keepScroll = false) {
  const scrollTop = els.scroller.scrollTop;
  els.content.innerHTML = doc.html;
  enhanceContent();
  buildToc();
  els.scroller.scrollTop = keepScroll ? scrollTop : 0;
  els.exportBtn.hidden = false;
}

function slugify(text: string, index: number): string {
  const base = text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
  return `${base ? `h-${base}` : 'h'}-${index}`;
}

function enhanceContent() {
  const headings = els.content.querySelectorAll<HTMLElement>('h1, h2, h3, h4');
  headings.forEach((heading, index) => {
    heading.id = slugify(heading.textContent ?? '', index);
    const anchor = document.createElement('a');
    anchor.className = 'heading-anchor';
    anchor.href = docHash(spaceId ?? '', current);
    anchor.setAttribute('aria-label', '定位到此处');
    anchor.innerHTML = ANCHOR_SVG;
    anchor.addEventListener('click', (event) => {
      event.preventDefault();
      heading.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    heading.append(anchor);
  });

  for (const pre of els.content.querySelectorAll('pre')) {
    const code = pre.querySelector('code');
    if (!code) continue;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'copy-btn';
    button.title = '复制代码';
    button.setAttribute('aria-label', '复制代码');
    button.innerHTML = COPY_SVG;
    button.addEventListener('click', () => {
      navigator.clipboard.writeText(code.textContent ?? '').then(
        () => {
          button.classList.add('is-done');
          button.innerHTML = DONE_SVG;
          window.setTimeout(() => {
            button.classList.remove('is-done');
            button.innerHTML = COPY_SVG;
          }, 1500);
        },
        () => toast('复制失败', 'error'),
      );
    });
    pre.classList.add('has-copy');
    pre.append(button);
  }

  renderDiagrams(els.content);

  for (const table of els.content.querySelectorAll('table')) {
    if (table.parentElement?.classList.contains('xdoc-table__scroll')) continue;
    const wrapper = document.createElement('div');
    wrapper.className = 'xdoc-table__scroll';
    table.replaceWith(wrapper);
    wrapper.append(table);
  }

  for (const link of els.content.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    const href = link.getAttribute('href') ?? '';
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//')) {
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      continue;
    }
    if (/\.(md|markdown)([#?].*)?$/i.test(href)) {
      link.addEventListener('click', (event) => {
        event.preventDefault();
        if (!current || !spaceId) return;
        location.hash = docHash(spaceId, resolveRelative(current, href));
      });
      continue;
    }
    if (href.startsWith('#')) {
      link.addEventListener('click', (event) => {
        event.preventDefault();
        els.content.querySelector(`#${CSS.escape(href.slice(1))}`)?.scrollIntoView({ behavior: 'smooth' });
      });
    }
  }

  for (const image of els.content.querySelectorAll<HTMLImageElement>('img[src]')) {
    const src = image.getAttribute('src') ?? '';
    if (/^(https?:)?\/\//i.test(src) || src.startsWith('data:') || src.startsWith('/api/') || !current || !spaceId) continue;
    // 图片是 <img> 发的请求，带不了请求头，令牌只能走查询串
    image.src = withToken(
      `/api/asset?space=${encodeURIComponent(spaceId)}&path=${encodeURIComponent(resolveRelative(current, src))}`,
    );
  }
}

// ---------- 目录 (TOC) ----------

/** 标题行右侧的收起按钮。收起只藏列表，标题留着，随时能再展开 */
function buildTocHead(): HTMLElement {
  const head = document.createElement('div');
  head.className = 'toc__head';
  const title = document.createElement('div');
  title.className = 'toc__title';
  title.textContent = '本文目录';
  tocToggle = document.createElement('button');
  tocToggle.type = 'button';
  tocToggle.className = 'toc__toggle';
  tocToggle.innerHTML = TOC_CARET_SVG;
  tocToggle.addEventListener('click', () => setTocCollapsed(!els.toc.classList.contains('is-collapsed')));
  head.append(title, tocToggle);
  return head;
}

function setTocCollapsed(collapsed: boolean) {
  els.toc.classList.toggle('is-collapsed', collapsed);
  localStorage.setItem(TOC_KEY, collapsed ? 'collapsed' : 'expanded');
  if (!tocToggle) return;
  tocToggle.title = collapsed ? '展开目录' : '收起目录';
  tocToggle.setAttribute('aria-label', tocToggle.title);
  tocToggle.setAttribute('aria-expanded', String(!collapsed));
}

function buildToc() {
  tocObserver?.disconnect();
  tocObserver = null;
  tocToggle = null;
  els.toc.innerHTML = '';
  const headings = [...els.content.querySelectorAll<HTMLElement>('h2, h3')];
  if (headings.length < 2) {
    els.toc.classList.add('is-hidden');
    return;
  }
  els.toc.classList.remove('is-hidden');

  const list = document.createElement('ul');
  for (const heading of headings) {
    const item = document.createElement('li');
    item.className = heading.tagName === 'H3' ? 'toc__item toc__item--sub' : 'toc__item';
    const link = document.createElement('a');
    link.href = docHash(spaceId ?? '', current);
    link.dataset.target = heading.id;
    link.textContent = (heading.textContent ?? '').trim();
    link.title = link.textContent;
    link.addEventListener('click', (event) => {
      event.preventDefault();
      heading.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    item.append(link);
    list.append(item);
  }
  els.toc.append(buildTocHead(), list);
  setTocCollapsed(localStorage.getItem(TOC_KEY) === 'collapsed');

  tocObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        for (const link of els.toc.querySelectorAll<HTMLAnchorElement>('a')) {
          link.classList.toggle('is-active', link.dataset.target === entry.target.id);
        }
      }
    },
    { root: els.scroller, rootMargin: '0px 0px -70% 0px', threshold: 0 },
  );
  for (const heading of headings) tocObserver.observe(heading);
}

// ---------- 导出为独立 HTML ----------

/**
 * 导出靠的是「把浏览器已经渲染好的 DOM 序列化下来」：mermaid 此时已是内联 SVG，
 * 图片走一遍 base64，CSS 取当前全局样式加空间自定义样式。
 * 因此导出结果不依赖任何脚本，也不需要服务端再渲染一次。
 */

/** 当前生效主题。没手动切过时 data-theme 是空的，要按系统偏好定死一个值，导出才是确定的 */
function effectiveTheme(): 'light' | 'dark' {
  const explicit = document.documentElement.dataset.theme;
  if (explicit === 'dark' || explicit === 'light') return explicit;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('读取图片失败'));
    reader.readAsDataURL(blob);
  });
}

/** 把指向服务的图片抓下来内联，导出的文件才能离线看 */
async function inlineImages(root: HTMLElement) {
  const images = [...root.querySelectorAll<HTMLImageElement>('img[src]')];
  await Promise.all(
    images.map(async (image) => {
      const src = image.getAttribute('src') ?? '';
      if (!src.startsWith('/api/asset')) return;
      try {
        const response = await fetch(src);
        if (!response.ok) throw new Error(String(response.status));
        image.src = await blobToDataUrl(await response.blob());
      } catch {
        // 取不到就留个空图，总比让导出整个失败好
        image.removeAttribute('src');
      }
    }),
  );
}

/**
 * echarts 画在 canvas 上，克隆出来的 canvas 是空白的。
 * 按文档顺序把克隆里的 canvas 换成原 DOM 对应 canvas 的位图。
 */
function rasterizeCharts(live: HTMLElement, clone: HTMLElement) {
  const liveCanvases = [...live.querySelectorAll<HTMLCanvasElement>('.xdoc-echarts__view canvas')];
  clone.querySelectorAll('canvas').forEach((canvas, index) => {
    const source = liveCanvases[index];
    if (!source) {
      canvas.remove();
      return;
    }
    const image = document.createElement('img');
    image.src = source.toDataURL('image/png');
    canvas.replaceWith(image);
  });
}

/** 去掉只在应用里才有意义的交互元素与运行时标记 */
function stripInteractive(root: HTMLElement) {
  root.querySelectorAll('.copy-btn').forEach((node) => node.remove());
  root.querySelectorAll('pre.has-copy').forEach((node) => node.classList.remove('has-copy'));
  root.querySelectorAll<HTMLElement>('[data-xdoc-mermaid], [data-xdoc-echarts]').forEach((figure) => {
    const source = figure.querySelector<HTMLElement>('.xdoc-diagram__src');
    // 已渲染出图就不需要原始源码了；还没渲染完（刚打开就点导出）则把源码露出来，
    // 总比留一个空白框好
    if (figure.querySelector('svg, img, canvas')) {
      source?.remove();
    } else {
      source?.removeAttribute('hidden');
      figure.querySelector('.xdoc-mermaid__view, .xdoc-echarts__view')?.remove();
    }
    figure.removeAttribute('data-xdoc-mermaid');
    figure.removeAttribute('data-xdoc-echarts');
    figure.removeAttribute('data-rendered');
  });
  // 标题锚点在应用里指向站内路由，导出后改成页内锚点
  root.querySelectorAll<HTMLAnchorElement>('.heading-anchor').forEach((anchor) => {
    const heading = anchor.closest('h1, h2, h3, h4');
    if (heading?.id) anchor.href = `#${heading.id}`;
    else anchor.remove();
  });
}

/**
 * 导出文件里的「本文目录」。应用里的 #toc 是独立面板、不随正文克隆，
 * 这里直接照正文标题另生成一份纯锚点列表——离线文件里没有脚本，
 * 收起/展开交给 <details>，所以不需要 JS。
 */
function insertExportToc(clone: HTMLElement) {
  const headings = [...clone.querySelectorAll<HTMLElement>('h2, h3')].filter((heading) => heading.id);
  // 与应用里的取舍一致：标题太少就不值得放目录
  if (headings.length < 2) return;
  const items = headings
    .map((heading) => {
      const sub = heading.tagName === 'H3' ? ' toc__item--sub' : '';
      const label = escapeHtml((heading.textContent ?? '').trim());
      return `<li class="toc__item${sub}"><a href="#${heading.id}">${label}</a></li>`;
    })
    .join('');
  const toc = `<details class="xdoc-toc" open><summary class="xdoc-toc__title">本文目录</summary><ul>${items}</ul></details>`;
  // 放在文档大标题之后：目录排在自己的标题前面很别扭；没有大标题就直接放最前面
  const lead = clone.querySelector('h1');
  if (lead) lead.insertAdjacentHTML('afterend', toc);
  else clone.insertAdjacentHTML('afterbegin', toc);
}

function exportFileName(): string {
  const base = (current ?? 'document').split('/').pop() ?? 'document';
  const stem = base.replace(/\.(md|markdown)$/i, '') || 'document';
  return `${stem}.html`;
}

function buildExportDocument(contentHtml: string, css: string): string {
  const title = document.title.replace(/\s*·\s*xdoc$/, '') || 'xdoc';
  const layout = [
    // 复用应用自己的排版类，只把「可滚动面板」的约束放开，让它变成普通文档流
    'html, body { height: auto; }',
    '.content-wrap { display: block; overflow: visible; padding: 0 24px; }',
    '.content { margin: 0 auto; padding: 48px 0 96px; }',
    // 导出文件里的目录。列表项复用 .toc__item 的样式，这里只补容器与 <details> 的壳
    '.xdoc-toc { margin: 0 0 2.2em; padding: 14px 18px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--bg-soft); font-size: 13px; }',
    '.xdoc-toc__title { cursor: pointer; font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-mute); }',
    '.xdoc-toc__title:hover { color: var(--accent); }',
    '.xdoc-toc[open] .xdoc-toc__title { margin-bottom: 10px; }',
    '.xdoc-toc ul { list-style: none; margin: 0; padding: 0; border-left: 1px solid var(--border); }',
  ].join('\n');
  return `<!DOCTYPE html>
<html lang="zh-CN" data-theme="${effectiveTheme()}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
${css}
${layout}
</style>
</head>
<body>
<div class="content-wrap">
<article class="content markdown-body">
${contentHtml}
</article>
</div>
</body>
</html>
`;
}

async function exportDoc() {
  if (!spaceId || !current) return;
  els.exportBtn.disabled = true;
  els.status.textContent = '导出中…';
  try {
    const clone = els.content.cloneNode(true) as HTMLElement;
    rasterizeCharts(els.content, clone);
    stripInteractive(clone);
    insertExportToc(clone);
    await inlineImages(clone);

    const [globalCss, customCss] = await Promise.all([
      fetch('/styles.css').then((response) => response.text()),
      fetch(withToken(`/api/styles?space=${encodeURIComponent(spaceId)}`)).then((response) => response.text()),
    ]);

    const html = buildExportDocument(clone.innerHTML, `${globalCss}\n${customCss}`);
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = exportFileName();
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    toast('已导出 HTML');
  } catch (error) {
    toast(`导出失败：${error instanceof Error ? error.message : error}`, 'error');
  } finally {
    els.exportBtn.disabled = false;
    els.status.textContent = '';
  }
}

// ---------- 样式与扩展信息 ----------

async function reloadStyles() {
  if (!spaceId) return;
  const id = spaceId;
  try {
    const css = await fetchStyles(id);
    if (spaceId === id) els.customStyles.textContent = css;
  } catch {
    /* 忽略 */
  }
}

async function loadEmbeds() {
  if (!spaceId) return;
  const id = spaceId;
  try {
    const embeds = await fetchEmbeds(id);
    if (spaceId !== id) return;
    els.embedCount.textContent = `${spaceName(id)} · ${embeds.length} 个嵌入体`;
    els.embedCount.title = embeds.map((embed) => embed.name).join('、');
  } catch {
    if (spaceId === id) els.embedCount.textContent = '';
  }
}

// ---------- 实时更新 ----------

function connectEvents() {
  // EventSource 也设不了请求头，同样走查询串
  const source = new EventSource(withToken('/api/events'));
  source.addEventListener('open', () => {
    els.status.textContent = '';
  });
  source.addEventListener('error', () => {
    els.status.textContent = '连接已断开，正在重试…';
  });

  source.addEventListener('change', (event) => {
    const data = JSON.parse((event as MessageEvent).data) as { space: string; path: string };
    if (data.space === spaceId && data.path === current) void refreshCurrent(true);
  });

  source.addEventListener('tree', async (event) => {
    const data = JSON.parse((event as MessageEvent).data) as { space: string };
    treeCache.delete(data.space);
    if (data.space !== spaceId) return;
    tree = await loadTree(spaceId, true);
    renderTree();
    filterTree(els.search.value);
  });

  source.addEventListener('config', (event) => {
    const data = JSON.parse((event as MessageEvent).data) as { space: string; path?: string };
    if (data.space !== spaceId) return;
    toast(`「${spaceName(spaceId)}」扩展已重新加载${data.path ? `：${data.path}` : ''}`);
    void reloadStyles();
    void loadEmbeds();
    void refreshCurrent(true);
  });

  source.addEventListener('config-error', (event) => {
    const data = JSON.parse((event as MessageEvent).data) as { message: string };
    toast(`扩展加载失败：${data.message}`, 'error');
  });

  source.addEventListener('spaces', async () => {
    const fallback = spaces[0]?.id ?? null;
    await reloadSpaces();
    if (!spaceId || !spaces.some((space) => space.id === spaceId)) {
      spaceId = fallback;
      if (spaceId) {
        history.replaceState(null, '', location.pathname);
        await route();
      } else {
        showEmptySpaces();
      }
    }
  });
}

// ---------- 窄屏侧栏抽屉 ----------

function openSidebar() {
  els.sidebar.classList.add('is-open');
  els.backdrop.classList.add('is-visible');
}

function closeSidebar() {
  els.sidebar.classList.remove('is-open');
  els.backdrop.classList.remove('is-visible');
}

// ---------- 访问令牌 ----------

/**
 * 从 ?token= 接过令牌并把它从地址栏抹掉。
 * 部署好之后可以直接把带令牌的链接发给别人；抹掉是为了不让它留在
 * 浏览历史、书签和 Referer 里。
 */
function absorbTokenFromUrl() {
  const url = new URL(location.href);
  const token = url.searchParams.get('token');
  if (!token) return;
  setToken(token);
  url.searchParams.delete('token');
  history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
}

function showGate(message = '') {
  els.gate.hidden = false;
  els.gateError.textContent = message;
  els.gateInput.value = '';
  els.gateInput.focus();
}

/** 输令牌 → 先探一次接口确认能用再存下来重载，免得存错了要反复试 */
async function submitGate() {
  const token = els.gateInput.value.trim();
  if (!token) {
    els.gateError.textContent = '请输入访问令牌';
    return;
  }
  els.gateSubmit.disabled = true;
  els.gateError.textContent = '验证中…';
  try {
    if (await verifyToken(token)) {
      setToken(token);
      location.reload();
      return;
    }
    els.gateError.textContent = '令牌不正确';
  } catch {
    els.gateError.textContent = '连接失败，请稍后再试';
  }
  els.gateSubmit.disabled = false;
}

/** 统一的错误出口：令牌不对就把浮层顶上来（比如服务端换了令牌），其余照常提示 */
function reportError(error: unknown) {
  if (error instanceof AuthError) {
    showGate(error.message);
    return;
  }
  toast(String(error instanceof Error ? error.message : error), 'error');
}

// ---------- 启动 ----------

async function boot() {
  initTheme();
  absorbTokenFromUrl();

  initSidebar();
  els.search.addEventListener('input', () => filterTree(els.search.value));
  els.search.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      els.search.value = '';
      filterTree('');
      els.search.blur();
    }
  });

  els.spaceBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    if (els.spaceMenu.hidden) openSpaceMenu();
    else closeSpaceMenu();
  });
  els.spaceEdit.addEventListener('submit', (event) => {
    event.preventDefault();
    void submitEditForm();
  });
  els.spaceEditCancel.addEventListener('click', closeEditForm);
  els.spaceCreateToggle.addEventListener('click', () => {
    if (els.spaceCreate.hidden) openCreateForm();
    else closeCreateForm();
  });
  els.spaceCreate.addEventListener('submit', (event) => {
    event.preventDefault();
    void submitCreateForm();
  });
  els.spaceCreateCancel.addEventListener('click', closeCreateForm);

  els.gateForm.addEventListener('submit', (event) => {
    event.preventDefault();
    void submitGate();
  });

  els.exportBtn.addEventListener('click', () => void exportDoc());
  els.newFile.addEventListener('click', () => beginCreate(null, 'file'));
  els.newFolder.addEventListener('click', () => beginCreate(null, 'folder'));
  document.addEventListener('click', (event) => {
    if (!els.spaceSwitch.contains(event.target as Node)) closeSpaceMenu();
  });

  window.addEventListener('hashchange', () => void route());
  window.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      els.search.focus();
      els.search.select();
    }
  });

  try {
    spaces = await fetchSpaces();
  } catch (error) {
    if (error instanceof AuthError) {
      // 没有令牌就没必要往下走了：树、正文、事件流全是 401，
      // 连上事件流只会让浏览器不停重连
      showGate();
      return;
    }
    toast(String(error instanceof Error ? error.message : error), 'error');
  }
  renderSpaces();
  connectEvents();
  await route();
}

void boot();