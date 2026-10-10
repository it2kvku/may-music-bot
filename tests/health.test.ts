import { once } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHealthServer } from '../src/health.js';

const servers: Server[] = [];
async function listen(isReady: () => boolean) {
  const server = createHealthServer(isReady);
  servers.push(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve()); server.closeAllConnections();
  })));
});
describe('HTTP health contract', () => {
  it('keeps liveness available before the Discord and audio connections are ready', async () => {
    const url = await listen(() => false);
    const response = await fetch(`${url}/healthz`);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ status: 'alive' });
  });
  it('tracks dependency readiness on every request', async () => {
    let ready = false;
    const url = await listen(() => ready);
    expect((await fetch(`${url}/readyz`)).status).toBe(503);
    ready = true;
    const response = await fetch(`${url}/readyz`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ready' });
    ready = false;
    expect((await fetch(`${url}/readyz`)).status).toBe(503);
  });
  it('has no write endpoints or catch-all route', async () => {
    const url = await listen(() => true);
    expect((await fetch(`${url}/healthz`, { method: 'POST' })).status).toBe(404);
    expect((await fetch(`${url}/private`)).status).toBe(404);
  });
});
