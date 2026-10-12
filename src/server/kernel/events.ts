import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * SSE 广播中心。跨模块共享：各模块只管 emit，不关心谁在听。
 */
export interface EventHub {
  /** 接过一条 /api/events 长连接 */
  attach(req: IncomingMessage, res: ServerResponse): void;
  broadcast(event: string, data: unknown): void;
  /** 服务关闭时切断所有长连接 */
  closeAll(): void;
}

export function createEventHub(): EventHub {
  const clients = new Set<ServerResponse>();

  return {
    attach(req, res) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      });
      res.write(': connected\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
    },

    broadcast(event, data) {
      const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
      for (const client of clients) client.write(payload);
    },

    closeAll() {
      for (const client of clients) client.end();
      clients.clear();
    },
  };
}
