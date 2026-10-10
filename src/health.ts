import { createServer } from 'node:http';
export function createHealthServer(isReady: () => boolean) {
  return createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    const pathname = request.url?.split('?')[0];
    if (request.method !== 'GET' || !['/healthz', '/readyz'].includes(pathname ?? '')) {
      response.writeHead(404).end(JSON.stringify({ error: 'not_found' })); return;
    }
    const ready = isReady();
    response.writeHead(pathname === '/readyz' && !ready ? 503 : 200).end(JSON.stringify({ status: pathname === '/healthz' ? 'alive' : ready ? 'ready' : 'not_ready' }));
  });
}
