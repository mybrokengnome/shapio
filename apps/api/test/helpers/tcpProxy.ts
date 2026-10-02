import { createConnection, createServer, type Server, type Socket } from 'node:net';

export type TcpProxy = {
  port: number;
  /** Simulates an outage: drops every open connection and refuses new ones until `resume`. */
  interrupt: () => Promise<void>;
  resume: () => Promise<void>;
  close: () => Promise<void>;
};

const listen = (server: Server, port: number) =>
  new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });

const closeServer = (server: Server) =>
  new Promise<void>((resolve) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close(() => resolve());
  });

/**
 * A loopback TCP proxy to `target`, so a test can take the database away from a child process and give it
 * back (a real outage as the process sees it: connections reset, new ones refused), without touching the
 * shared PostgreSQL server other test files use.
 */
export const startTcpProxy = async (target: { host: string; port: number }): Promise<TcpProxy> => {
  const sockets = new Set<Socket>();
  const track = (socket: Socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  };
  const createProxyServer = () =>
    createServer((client) => {
      const upstream = createConnection(target);
      track(client);
      track(upstream);
      client.on('error', () => upstream.destroy());
      upstream.on('error', () => client.destroy());
      client.pipe(upstream).pipe(client);
    });

  let server = createProxyServer();
  await listen(server, 0);
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Proxy has no port');
  }
  const { port } = address;

  return {
    port,
    interrupt: async () => {
      const closing = closeServer(server);
      for (const socket of sockets) {
        socket.destroy();
      }
      await closing;
    },
    resume: async () => {
      server = createProxyServer();
      await listen(server, port);
    },
    close: async () => {
      const closing = closeServer(server);
      for (const socket of sockets) {
        socket.destroy();
      }
      await closing;
    },
  };
};
