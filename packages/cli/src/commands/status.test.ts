import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CliIo } from '../types.js';
import { statusCommand } from './status.js';

const captureIo = () => {
  const out: string[] = [];
  const err: string[] = [];
  const io: CliIo = { stdout: (t) => out.push(t), stderr: (t) => err.push(t), env: {} };
  return { io, out, err };
};

describe('statusCommand', () => {
  let server: Server;
  let baseUrl: string;
  let ready = true;
  /** What the server answers: Shapio, an HTML page (an SPA fallback, a proxy's default page), or other JSON. */
  let mode: 'shapio' | 'html' | 'json' | 'notReady' = 'shapio';

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (mode === 'html') {
        res.setHeader('content-type', 'text/html');
        res.end('<!doctype html><title>Welcome</title>');
        return;
      }
      res.setHeader('content-type', 'application/json');
      if (mode === 'json') {
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      if (mode === 'notReady' && req.url === '/api/ready') {
        res.end(JSON.stringify({ status: 'starting' }));
        return;
      }
      if (req.url === '/api/version') {
        res.end(JSON.stringify({ name: 'shapio', version: '1.2.3', node: 'v24.0.0' }));
      } else if (req.url === '/api/ready' && ready) {
        res.end(JSON.stringify({ status: 'ready', checks: { database: 'ok', migrations: 'ok' } }));
      } else {
        res.statusCode = 503;
        res.end(JSON.stringify({ error: { code: 'NOT_READY', message: 'Service is not ready' } }));
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it('reports a ready instance and exits 0', async () => {
    mode = 'shapio';
    ready = true;
    const { io, out } = captureIo();
    expect(await statusCommand.run(['--url', baseUrl], io)).toBe(0);
    expect(out.join('')).toContain('ready (shapio 1.2.3');
  });

  it('reports the server error code and exits 1 when not ready', async () => {
    mode = 'shapio';
    ready = false;
    const { io, err } = captureIo();
    expect(await statusCommand.run(['--url', baseUrl], io)).toBe(1);
    expect(err.join('')).toContain('NOT_READY');
  });

  it.each([
    ['an HTML page', 'html'],
    ['JSON that is not Shapio', 'json'],
  ] as const)('exits 1 for a server that answers 200 with %s', async (_label, answer) => {
    mode = answer;
    const { io, out, err } = captureIo();
    expect(await statusCommand.run(['--url', baseUrl], io)).toBe(1);
    expect(out.join('')).toBe('');
    expect(err.join('')).toContain('not a Shapio instance');
  });

  it('exits 1 when /api/ready answers 200 without status ready', async () => {
    mode = 'notReady';
    const { io, err } = captureIo();
    expect(await statusCommand.run(['--url', baseUrl], io)).toBe(1);
    expect(err.join('')).toContain('not ready');
  });
});
