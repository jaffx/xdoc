export interface SpaceInfo {
  id: string;
  name: string;
  root: string;
  source: 'cli' | 'user';
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

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
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
  path: string;
  name?: string;
  description?: string;
  /** true 表示目录不存在时直接创建（并生成 index.md） */
  create?: boolean;
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
  const response = await fetch(`/api/styles?space=${encodeURIComponent(space)}`);
  return response.ok ? response.text() : '';
}

export function fetchEmbeds(space: string): Promise<EmbedInfo[]> {
  return request<EmbedInfo[]>(`/api/embeds?space=${encodeURIComponent(space)}`);
}