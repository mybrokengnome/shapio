import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { appendVary } from './vary.js';

const varyAfter = async (existing: string | undefined, names: string) => {
  const app = Fastify();
  app.get('/', async (_request, reply) => {
    if (existing !== undefined) {
      reply.header('vary', existing);
    }
    appendVary(reply, names);
    return 'ok';
  });
  const response = await app.inject({ method: 'GET', url: '/' });
  await app.close();
  return response.headers.vary;
};

describe('appendVary', () => {
  it('sets the names on a reply without Vary', async () => {
    expect(await varyAfter(undefined, 'Authorization, Cookie')).toBe('Authorization, Cookie');
  });

  it('keeps names already there (CORS Origin) and adds each new name once, case-insensitively', async () => {
    expect(await varyAfter('Origin', 'Authorization, Cookie')).toBe('Origin, Authorization, Cookie');
    expect(await varyAfter('origin, cookie', 'Authorization, Cookie')).toBe('origin, cookie, Authorization');
  });

  it('leaves Vary: * alone', async () => {
    expect(await varyAfter('*', 'Authorization')).toBe('*');
  });
});
