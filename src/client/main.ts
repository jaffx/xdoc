import {
  addSpace,
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
  updateSpace,
  type DocPayload,
  type SpaceInfo,
  type TreeNode,
} from './api';

const $ = <T extends Element = HTMLElement>(selector: string) => document.querySelector(selector) as T;

const els = {
  tree: $('#tree'),
  content: $('#content'),
  toc: $('#toc'),
  search: $('#search') as HTMLInputElement,
  crumb: $('#crumb'),
  status: $('#status'),
  scroller: $('#scroller'),
  toast: $('#toast'),
  themeToggle: $('#theme-toggle'),
  menuToggle: $('#menu-toggle'),
  backdrop: $('#sidebar-backdrop'),
  sidebar: $('#sidebar'),
  customStyles: $('#custom-styles'),
  embedCount: $('#embed-count'),
  spaceRoot: $('#space-root'),
  spaceSwitch: $('#space-switch'),
  spaceBtn: $('#space-btn'),
  spaceBtnName: $('#space-btn-name'),
  spaceMenu: $('#space-menu'),
  spaceList: $('#space-list'),
  spacePath: $('#space-path') as HTMLInputElement,
  spaceAdd: $('#space-add'),
  spaceCreateToggle: $('#space-create-toggle'),
  spaceEdit: $('#space-edit') as HTMLFormElement,
  spaceEditName: $('#space-edit-name') as HTMLInputElement,
  spaceEditDesc: $('#space-edit-desc') as HTMLTextAreaElement,
  spaceEditCancel: $('#space-edit-cancel'),
  spaceCreate: $('#space-create') as HTMLFormElement,
  spaceCreateParent: $('#space-create-parent') as HTMLInputElement,
  spaceCreateName: $('#space-create-name') as HTMLInputElement,
  spaceCreateDesc: $('#space-create-desc') as HTMLTextAreaElement,
  spaceCreateCancel: $('#space-create-cancel'),
  newFile: $('#new-file'),
  newFolder: $('#new-folder'),
};

const SPACE_KEY = 'xdoc:space';
const LAST_DOC_KEY = 'xdoc:lastDocs';

const CARET_SVG =
  '<svg class="tree__caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>';
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
  });
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
  els.spaceRoot.textContent = active?.root ?? '';

  els.spaceList.innerHTML = '';
  for (const space of spaces) {
    const row = document.createElement('div');
    row.className = `space-item${space.id === spaceId ? ' is-active' : ''}`;

    const main = document.createElement('button');
    main.type = 'button';
    main.className = 'space-item__main';
    const subtitle = space.description ?? space.root;
    main.title = `${space.name}\n${space.root}${space.description ? `\n${space.description}` : ''}`;
    main.innerHTML = `<span class="space-item__name">${escapeHtml(space.name)}</span><span class="space-item__sub${space.description ? ' is-desc' : ''}">${escapeHtml(subtitle)}</span>`;
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
          toast(error instanceof Error ? error.message : String(error), 'error');
        }
      });
      row.append(remove);
    }
    els.spaceList.append(row);
  }
}

function parentDir(target: string): string {
  const index = Math.max(target.lastIndexOf('/'), target.lastIndexOf('\\'));
  if (index <= 0) return '/';
  return target.slice(0, index);
}

function joinPath(parent: string, name: string): string {
  const base = parent.replace(/[\\/]+$/, '');
  return base ? `${base}/${name}` : name;
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
  const active = spaces.find((space) => space.id === spaceId);
  els.spaceCreateParent.value = active ? parentDir(active.root) : '';
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
    if (updated.id === spaceId && current) els.crumb.textContent = `${updated.name} / ${current}`;
    toast(`已更新空间「${updated.name}」`);
  } catch (error) {
    toast(error instanceof Error ? error.message : String(error), 'error');
  }
}

async function submitCreateForm() {
  const parent = els.spaceCreateParent.value.trim();
  const name = els.spaceCreateName.value.trim();
  if (!parent || !name) {
    toast('请填写位置与名称', 'error');
    return;
  }
  try {
    const { space, created } = await addSpace({
      path: joinPath(parent, name),
      name,
      description: els.spaceCreateDesc.value.trim() || undefined,
      create: true,
    });
    closeSpaceMenu();
    await reloadSpaces();
    if (space.id !== spaceId) location.hash = docHash(space.id, null);
    toast(created ? `已创建空间「${space.name}」` : `空间已存在：${space.name}`);
  } catch (error) {
    toast(error instanceof Error ? error.message : String(error), 'error');
  }
}

function openSpaceMenu() {
  els.spaceMenu.hidden = false;
  els.spaceBtn.setAttribute('aria-expanded', 'true');
  els.spacePath.focus();
}

function closeSpaceMenu() {
  els.spaceMenu.hidden = true;
  els.spaceBtn.setAttribute('aria-expanded', 'false');
  closeEditForm();
  closeCreateForm();
}

async function submitAddSpace() {
  const value = els.spacePath.value.trim();
  if (!value) return;
  els.spaceAdd.setAttribute('disabled', 'true');
  try {
    const { space, created } = await addSpace({ path: value });
    els.spacePath.value = '';
    closeSpaceMenu();
    await reloadSpaces();
    if (space.id !== spaceId) location.hash = docHash(space.id, null);
    toast(created ? `已添加空间「${space.name}」` : `空间已存在：${space.name}`);
  } catch (error) {
    toast(error instanceof Error ? error.message : String(error), 'error');
  } finally {
    els.spaceAdd.removeAttribute('disabled');
  }
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
    button.innerHTML = `${CARET_SVG}<span>${escapeHtml(node.name)}</span>`;
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
    link.innerHTML = `<span>${escapeHtml(label)}</span>`;
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
        toast(error instanceof Error ? error.message : String(error), 'error');
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
          els.crumb.textContent = `${spaceName(spaceId)} / ${current}`;
        }
      }
      pendingInput = null;
      await refreshTree();
      toast(`已重命名为 ${path}`);
    } catch (error) {
      busy = false;
      input.disabled = false;
      input.focus();
      toast(error instanceof Error ? error.message : String(error), 'error');
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
    toast(error instanceof Error ? error.message : String(error), 'error');
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
  els.tree.innerHTML = '';
  els.tree.append(buildList(tree));
  markActive();
}

function markActive() {
  for (const link of els.tree.querySelectorAll<HTMLAnchorElement>('.tree__file a')) {
    const item = link.closest<HTMLElement>('.tree__file');
    const active = item?.dataset.path === current;
    link.classList.toggle('is-active', active);
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

function filterTree(query: string) {
  const q = query.trim().toLowerCase();
  for (const file of els.tree.querySelectorAll<HTMLElement>('.tree__file')) {
    const matched = q.length === 0 || (file.dataset.path ?? '').toLowerCase().includes(q);
    file.classList.toggle('is-hidden', !matched);
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
  els.tree.innerHTML = '';
  els.content.innerHTML = '<div class="empty"><h1>没有可用空间</h1><p>在下方输入目录路径添加一个空间。</p></div>';
  els.crumb.textContent = '首页';
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
      els.crumb.textContent = spaceName(spaceId);
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
  els.crumb.textContent = `${spaceName(id)} / ${rel}`;
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
    els.content.innerHTML = `<div class="empty"><h1>加载失败</h1><p>${escapeHtml(String(error instanceof Error ? error.message : error))}</p></div>`;
    els.status.textContent = '';
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
    toast(String(error instanceof Error ? error.message : error), 'error');
  }
}

function renderDoc(doc: DocPayload, keepScroll = false) {
  const scrollTop = els.scroller.scrollTop;
  els.content.innerHTML = doc.html;
  enhanceContent();
  buildToc();
  els.scroller.scrollTop = keepScroll ? scrollTop : 0;
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

  for (const box of els.content.querySelectorAll<HTMLElement>('[data-xdoc-todo]')) {
    box.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach((input) => {
      input.addEventListener('change', () => {
        input.closest('.xdoc-todo__item')?.classList.toggle('is-done', input.checked);
        recalcTodo(box);
      });
    });
    recalcTodo(box);
  }

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
    image.src = `/api/asset?space=${encodeURIComponent(spaceId)}&path=${encodeURIComponent(resolveRelative(current, src))}`;
  }
}

function recalcTodo(box: HTMLElement) {
  const inputs = [...box.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
  const done = inputs.filter((input) => input.checked).length;
  const total = inputs.length;
  const percent = total === 0 ? 0 : Math.round((done / total) * 100);
  box.dataset.done = String(done);
  box.dataset.total = String(total);
  const bar = box.querySelector<HTMLElement>('.xdoc-todo__bar i');
  if (bar) bar.style.width = `${percent}%`;
  const count = box.querySelector<HTMLElement>('.xdoc-todo__count');
  if (count) count.textContent = `${done}/${total}`;
}

// ---------- 目录 (TOC) ----------

function buildToc() {
  tocObserver?.disconnect();
  tocObserver = null;
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
  els.toc.append(list);

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
  const source = new EventSource('/api/events');
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

// ---------- 移动端侧栏 ----------

function openSidebar() {
  els.sidebar.classList.add('is-open');
  els.backdrop.classList.add('is-visible');
}

function closeSidebar() {
  els.sidebar.classList.remove('is-open');
  els.backdrop.classList.remove('is-visible');
}

// ---------- 启动 ----------

async function boot() {
  initTheme();

  els.menuToggle.addEventListener('click', () => {
    if (els.sidebar.classList.contains('is-open')) closeSidebar();
    else openSidebar();
  });
  els.backdrop.addEventListener('click', closeSidebar);
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
  els.spaceAdd.addEventListener('click', () => void submitAddSpace());
  els.spacePath.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') void submitAddSpace();
    if (event.key === 'Escape') closeSpaceMenu();
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
    toast(String(error instanceof Error ? error.message : error), 'error');
  }
  renderSpaces();
  connectEvents();
  await route();
}

void boot();