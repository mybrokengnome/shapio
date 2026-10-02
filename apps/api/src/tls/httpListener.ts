import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { FastifyBaseLogger } from 'fastify';
import type { UrlBuilder } from '../helpers/publicUrl.js';

export type HttpListener = { port: number; close: () => Promise<void> };

type HttpListenerOptions = {
  host: string;
  port: number;
  urls: UrlBuilder;
  log: FastifyBaseLogger;
};

/**
 * The plain-HTTP side when Shapio serves HTTPS itself (HTTP_PORT): permanently redirects every request to
 * HTTPS on PUBLIC_URL, keeping the path and query.
 */
export const startHttpListener = async ({ host, port, urls, log }: HttpListenerOptions) => {
  const server: Server = createServer((request, response) => {
    response.writeHead(301, { location: urls.originUrl(request.url ?? '/') }).end();
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });
  const actualPort = (server.address() as AddressInfo).port;
  log.info({ port: actualPort }, 'HTTP listener started (redirect to HTTPS)');
  return {
    port: actualPort,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  } satisfies HttpListener;
};
