import type { FastifyInstance } from 'fastify';
import { describe, expect, it } from 'vitest';
import { isSecureRequest } from '../src/helpers/requestSecurity.js';
import { createTestApp } from './helpers/createTestApp.js';
import { useTestDatabase } from './helpers/testDatabase.js';

const registerProbe = (app: FastifyInstance) => {
  app.get('/test/probe', async (request) => ({ ip: request.ip, secure: isSecureRequest(request) }));
};

describe('TRUST_PROXY', () => {
  const database = useTestDatabase();

  const appWith = (trustProxy: string) =>
    createTestApp(database.current, {
      env: { TRUST_PROXY: trustProxy, RATE_LIMIT_MAX: '2' },
      register: registerProbe,
    });

  const probe = (app: FastifyInstance, forwardedFor: string, forwardedProto = 'https') =>
    app.inject({
      method: 'GET',
      url: '/test/probe',
      remoteAddress: '10.0.0.1',
      headers: { 'x-forwarded-for': forwardedFor, 'x-forwarded-proto': forwardedProto },
    });

  it('when trusted, uses X-Forwarded-For for the client IP and rate limiting, and X-Forwarded-Proto for Secure', async () => {
    const { app } = await appWith('true');
    try {
      const first = await probe(app, '203.0.113.1');
      expect(first.json()).toEqual({ ip: '203.0.113.1', secure: true });
      await probe(app, '203.0.113.1');
      expect((await probe(app, '203.0.113.1')).statusCode).toBe(429);
      // A different client behind the same proxy has its own budget.
      expect((await probe(app, '203.0.113.2')).statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });

  it('when not trusted, ignores forwarded headers (one budget per socket address, not Secure)', async () => {
    const { app } = await appWith('false');
    try {
      expect((await probe(app, '203.0.113.1')).json()).toEqual({ ip: '10.0.0.1', secure: false });
      await probe(app, '203.0.113.2');
      expect((await probe(app, '203.0.113.3')).statusCode).toBe(429);
    } finally {
      await app.close();
    }
  });

  it('with a hop count, trusts only that many proxies', async () => {
    const { app } = await appWith('1');
    try {
      // Client-supplied 198.51.100.7 is spoofed; the one trusted proxy appended the real client 203.0.113.9.
      expect((await probe(app, '198.51.100.7, 203.0.113.9')).json()).toMatchObject({ ip: '203.0.113.9' });
    } finally {
      await app.close();
    }
  });
});
