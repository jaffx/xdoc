import { timingSafeEqual } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ConflictError,
  InvalidInputError,
  InvalidPathError,
  NotFoundError,
  PathEscapeError,
} from './errors';

export const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  // ES module 分块（mermaid 等），必须是 JS MIME，否则浏览器拒绝加载
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.pdf': 'application/pdf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

/** 已经确定协议码的错误：入口层自己的参数校验用它，领域错误一律不用 */
export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

export function httpError(statusCode: number, message: string): HttpError {
  return new HttpError(statusCode, message);
}

/**
 * 错误类型 → 协议码。**全项目唯一**的这张表（R7：入口层不抛业务错误，只映射）。
 *
 * 领域层不认识 HTTP，所以「越界是 403、找不到是 404」这类知识只存在于这里。
 * 换一个入口（MCP / CLI）就换一张表，领域层一行都不用动。
 */
export function statusOf(error: unknown): number {
  if (error instanceof HttpError) return error.statusCode;
  if (error instanceof NotFoundError) return 404;
  if (error instanceof ConflictError) return 409;
  if (error instanceof PathEscapeError) return 403;
  if (error instanceof InvalidPathError) return 400;
  if (error instanceof InvalidInputError) return 400;
  return 500;
}

export function findPublicDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(here, 'public'),
    path.join(here, '..', '..', 'dist', 'public'),
    path.join(process.cwd(), 'dist', 'public'),
    path.join(process.cwd(), 'public'),
  ];
  return candidates.find((dir) => existsSync(path.join(dir, 'index.html'))) ?? candidates[0];
}

export function decodePathname(pathname: string): string {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return pathname;
  }
}

export async function readBody(req: IncomingMessage, maxBytes = 64 * 1024): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw httpError(413, '请求体过大');
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const raw = await readBody(req);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw httpError(400, 'JSON 解析失败');
  }
}

export interface MultipartPart {
  name: string;
  filename?: string;
  data: Buffer;
}

export function parseMultipart(body: Buffer, boundary: string): MultipartPart[] {
  const parts: MultipartPart[] = [];
  const boundaryBuffer = Buffer.from(`--${boundary}`);
  const endBuffer = Buffer.from(`--${boundary}--`);

  let start = body.indexOf(boundaryBuffer);
  if (start === -1) return parts;

  while (true) {
    start = body.indexOf(boundaryBuffer, start);
    if (start === -1) break;

    start += boundaryBuffer.length;
    if (body[start] === 0x0d && body[start + 1] === 0x0a) {
      start += 2;
    }

    const end = body.indexOf(boundaryBuffer, start);
    if (end === -1) break;

    const partData = body.subarray(start, end);
    const headerEnd = partData.indexOf('\r\n\r\n');
    if (headerEnd === -1) continue;

    const headers = partData.subarray(0, headerEnd).toString('utf8');
    const content = partData.subarray(headerEnd + 4, partData.length - 2);

    const nameMatch = /name="([^"]+)"/.exec(headers);
    const filenameMatch = /filename="([^"]+)"/.exec(headers);

    if (nameMatch) {
      parts.push({
        name: nameMatch[1],
        filename: filenameMatch?.[1],
        data: content,
      });
    }

    if (body.subarray(end, end + endBuffer.length).equals(endBuffer)) break;
  }

  return parts;
}

/** Authorization: Bearer <令牌> 里的令牌部分，取不到返回空串 */
export function bearerToken(req: IncomingMessage): string {
  const raw = req.headers.authorization;
  if (typeof raw !== 'string') return '';
  const match = /^Bearer\s+(.+)$/i.exec(raw.trim());
  return match ? match[1].trim() : '';
}

/** 等长比较，避免按字符逐位比较泄露令牌前缀 */
export function tokenEquals(expected: string, actual: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(actual);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function sendJson(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
  res.end(body);
}

export function sendFile(res: ServerResponse, file: string): void {
  const type = MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  createReadStream(file).pipe(res);
}
