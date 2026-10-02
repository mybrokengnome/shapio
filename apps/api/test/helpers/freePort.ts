import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';

/** A TCP port that was free a moment ago on 127.0.0.1. */
export const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      server.close(() => resolve(port));
    });
  });
