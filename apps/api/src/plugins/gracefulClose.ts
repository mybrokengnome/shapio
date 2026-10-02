import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

/**
 * Lets shutdown finish promptly. `app.close()` waits for every open connection, and Node only closes the
 * connections that are idle when it starts. A request already running at that moment would otherwise leave
 * its keep-alive connection open after answering, holding shutdown until the client's idle timeout. So
 * while closing, every answer carries `Connection: close` and its connection ends once it is sent.
 * (Fastify itself only does this for requests that arrive after closing has begun.)
 */
export const gracefulClosePlugin = fp(async (app: FastifyInstance) => {
  let closing = false;
  app.addHook('preClose', async () => {
    closing = true;
  });
  app.addHook('onSend', async (request, reply) => {
    if (closing && request.raw.httpVersionMajor < 2) {
      reply.header('connection', 'close');
    }
  });
});
