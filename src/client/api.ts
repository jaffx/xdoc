/** 空间信息不含文件系统路径：空间的实际位置由服务端管理 */
export interface SpaceInfo {
  id: string;
  name: string;
  description?: string;
  createdAt?: number;
  updatedAt?: number;
}

export interface TreeNode {
  name: string;
  path: string;
  type: 'dir' | 'file';
  children?: TreeNode[];
}

export interface DocPayload {
  space: string;
  path: string;
  title: string;
  html: string;
  mtime: number;
}

export interface EmbedInfo {
  name: string;
  aliases: string[];
  description: string;
}

export interface AssetInfo {
  path: string;
  name: string;
  size: number;
  mimeType: string;
  mtime: number;
}

const TOKEN_KEY = 'xdoc:token';

/** 服务端要求令牌但本地没有 / 不对时抛这个，调用方据此弹输入框而不是当普通故障 */
export class AuthError extends Error {}

export function getToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? '';
  } catch {
    // 隐私模式下 localStorage 不可用，只能每次重输
    return '';
  }
}

export function setToken(token: string): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* 存不下就算了，这一次会话仍可用 */
  }
}

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * 把令牌挂到 URL 上。`<img>` 与 `EventSource` 设不了请求头，只能走查询串——
 * 服务端两种都认。
 */
export function withToken(url: string): string {
  const token = getToken();
  if (!token) return url;
  return `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;
}

/** 用指定令牌探一次接口，用于输入令牌后先验证再保存 */
export async function verifyToken(token: string): Promise<boolean> {
  const response = await fetch('/api/spaces', {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  return response.ok;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { ...authHeaders(), ...((init?.headers as Record<string, string>) ?? {}) },
  });
  if (response.status === 401) throw new AuthError('需要访问令牌');
  if (!response.ok) {
    let message = `请求失败（${response.status}）`;
    try {
      const data = (await response.json()) as { error?: string };
      if (data.error) message = data.error;
    } catch {
      /* 忽略解析错误 */
    }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

export function fetchSpaces(): Promise<SpaceInfo[]> {
  return request<SpaceInfo[]>('/api/spaces');
}

export interface AddSpacePayload {
  /** 空间名称；目录名由服务端在数据根目录下派生 */
  name: string;
  description?: string;
}

export function addSpace(payload: AddSpacePayload): Promise<{ space: SpaceInfo; created: boolean }> {
  return request('/api/spaces', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export function updateSpace(id: string, patch: { name?: string; description?: string }): Promise<SpaceInfo> {
  return request('/api/spaces', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, ...patch }),
  });
}

export function removeSpace(id: string): Promise<{ ok: boolean }> {
  return request(`/api/spaces?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export function createFolder(space: string, path: string): Promise<{ space: string; path: string }> {
  return request('/api/mkdir', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ space, path }),
  });
}

export function createDoc(space: string, path: string, content?: string): Promise<{ space: string; path: string }> {
  return request('/api/file', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ space, path, content }),
  });
}

export function renameEntry(space: string, from: string, to: string): Promise<{ space: string; path: string }> {
  return request('/api/rename', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ space, from, to }),
  });
}

export function deleteEntry(space: string, path: string, recursive = false): Promise<{ space: string; path: string }> {
  return request(`/api/entry?space=${encodeURIComponent(space)}&path=${encodeURIComponent(path)}&recursive=${recursive}`, {
    method: 'DELETE',
  });
}

export function fetchTree(space: string): Promise<TreeNode[]> {
  return request<TreeNode[]>(`/api/tree?space=${encodeURIComponent(space)}`);
}

export function fetchDoc(space: string, path: string): Promise<DocPayload> {
  return request<DocPayload>(`/api/doc?space=${encodeURIComponent(space)}&path=${encodeURIComponent(path)}`);
}

export async function fetchStyles(space: string): Promise<string> {
  const response = await fetch(withToken(`/api/styles?space=${encodeURIComponent(space)}`), { headers: authHeaders() });
  if (response.status === 401) throw new AuthError('需要访问令牌');
  return response.ok ? response.text() : '';
}

export function fetchEmbeds(space: string): Promise<EmbedInfo[]> {
  return request<EmbedInfo[]>(`/api/embeds?space=${encodeURIComponent(space)}`);
}

export function fetchAssets(space: string, dir?: string): Promise<{ space: string; items: AssetInfo[] }> {
  const url = dir
    ? `/api/assets?space=${encodeURIComponent(space)}&dir=${encodeURIComponent(dir)}`
    : `/api/assets?space=${encodeURIComponent(space)}`;
  return request(url);
}

export async function uploadAsset(space: string, file: File, targetPath?: string): Promise<AssetInfo> {
  const formData = new FormData();
  formData.append('file', file);
  if (targetPath) formData.append('path', targetPath);

  const response = await fetch(`/api/assets/upload?space=${encodeURIComponent(space)}`, {
    method: 'POST',
    headers: authHeaders(),
    body: formData,
  });

  if (response.status === 401) throw new AuthError('需要访问令牌');
  if (!response.ok) {
    const data = (await response.json()) as { error?: string };
    throw new Error(data.error ?? '上传失败');
  }

  const data = (await response.json()) as { asset: AssetInfo };
  return data.asset;
}

export function renameAsset(space: string, from: string, to: string): Promise<{ space: string; from: string; to: string }> {
  return request('/api/assets/rename', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ space, from, to }),
  });
}

export function deleteAsset(space: string, path: string): Promise<{ space: string; path: string }> {
  return request(`/api/assets?space=${encodeURIComponent(space)}&path=${encodeURIComponent(path)}`, {
    method: 'DELETE',
  });
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
  at?: number;
  stopped?: boolean;
}

export function chat(
  message: string,
  space: string,
  options: { docPath?: string; model?: string } = {},
): Promise<{ reply: string }> {
  return request(`/api/chat?space=${encodeURIComponent(space)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, ...options }),
  });
}

export function fetchChatHistory(space: string): Promise<{ turns: ChatTurn[] }> {
  return request(`/api/chat/history?space=${encodeURIComponent(space)}`);
}

export function clearChatHistory(space: string): Promise<{ ok: boolean }> {
  return request(`/api/chat/history?space=${encodeURIComponent(space)}`, { method: 'DELETE' });
}

export function renderMarkdown(space: string, markdown: string): Promise<{ html: string }> {
  return request(`/api/render?space=${encodeURIComponent(space)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ markdown }),
  });
}
