import { createHmac } from 'node:crypto';
import { createServer, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect } from '@playwright/test';

export type ReceivedRequest = { method: string; path: string; headers: IncomingHttpHeaders; body: string };

/**
 * A local HTTP endpoint standing in for a webhook consumer or a site's build hook: records every request
 * and answers 200. Listens on loopback, which the e2e server allowlists (OUTBOUND_PRIVATE_NETWORK_ALLOWLIST).
 */
export const startReceiver = async () => {
  const requests: ReceivedRequest[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      requests.push({
        method: request.method ?? '',
        path: request.url ?? '',
        headers: request.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      });
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{"received":true}');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: (path: string) => `http://127.0.0.1:${port}${path}`,
    requests,
    /** Waits until a request matching `predicate` has arrived, and returns it. */
    waitFor: async (predicate: (request: ReceivedRequest) => boolean, timeout = 30_000) => {
      await expect.poll(() => requests.some(predicate), { timeout }).toBe(true);
      return requests.find(predicate) as ReceivedRequest;
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
};

/** `v1=<hex HMAC-SHA256(secret, "<timestamp>.<raw body>")>`, as Shapio signs and verifies. */
export const signBody = (secret: string, timestamp: number, body: string) =>
  `v1=${createHmac('sha256', secret).update(`${timestamp}.${body}`, 'utf8').digest('hex')}`;
