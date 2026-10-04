import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createDefinition, createDeliveryToken, expectStatus, type EntryBody } from './helpers/content.js';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import { createLogCapture, type LogCapture } from './helpers/logCapture.js';
import { createRoleToken, schemaClient } from './helpers/schemaAdmin.js';
import { useTestDatabase } from './helpers/testDatabase.js';

type LogLine = { level: number; msg: string; reqId?: string; [field: string]: unknown };

const INFO = 30;
const DEBUG = 20;

/** The request lines (those bound to a request id) written since `from`. */
const requestLinesSince = (logs: LogCapture, from: number): LogLine[] =>
  logs.lines
    .slice(from)
    .map((line) => JSON.parse(line) as LogLine)
    .filter((line) => line.reqId !== undefined);

describe('request logging', () => {
  const database = useTestDatabase();
  const infoLogs = createLogCapture('info');
  const debugLogs = createLogCapture('debug');
  let infoApp: TestApp;
  let debugApp: TestApp;
  let token: string;
  /** Warnings emitted while the apps were built (Fastify's deprecations go through process.emitWarning). */
  const startWarnings: string[] = [];

  /** Sends one request and returns the request lines it wrote. */
  const linesOf = async (
    testApp: TestApp,
    logs: LogCapture,
    url: string,
    bearer: string | null = token,
  ): Promise<{ statusCode: number; lines: LogLine[] }> => {
    const from = logs.lines.length;
    const response = await testApp.app.inject({
      method: 'GET',
      url,
      headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
    });
    return { statusCode: response.statusCode, lines: requestLinesSince(logs, from) };
  };

  beforeAll(async () => {
    const emitWarning = vi.spyOn(process, 'emitWarning');
    try {
      infoApp = await createTestApp(database.current, { schemaListen: false, logger: infoLogs.logger });
      debugApp = await createTestApp(database.current, { schemaListen: false, logger: debugLogs.logger });
      startWarnings.push(
        ...emitWarning.mock.calls.map((call) => call.map((part) => String(part as unknown)).join(' ')),
      );
    } finally {
      emitWarning.mockRestore();
    }
    const admin = schemaClient(infoApp.app, await createRoleToken(database.current.db));
    const article = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'article',
      label: 'Article',
      fields: [{ apiKey: 'title', label: 'Title', type: 'string', filterable: true }],
    });
    const entry = expectStatus(
      await admin.post('/api/admin/content/article', { data: { title: 'Hello' } }),
      201,
    ).json<EntryBody>();
    expectStatus(await admin.post(`/api/admin/content/article/${entry.id}/publish`, {}), 200);
    token = await createDeliveryToken(database.current.db, [{ modelId: article.definition.id }]);
  });
  afterAll(async () => {
    await infoApp.app.close();
    await debugApp.app.close();
  });

  it('starts without a Fastify deprecation warning', () => {
    expect(startWarnings.filter((warning) => warning.includes('FSTDEP'))).toEqual([]);
  });

  it('writes exactly one info line for a delivery GET, with the fields that matter', async () => {
    const { statusCode, lines } = await linesOf(
      infoApp,
      infoLogs,
      '/api/content/articles?filters[title][$eq]=Hello',
    );
    expect(statusCode).toBe(200);
    expect(lines).toHaveLength(1);
    const [line] = lines;
    expect(line).toMatchObject({
      level: INFO,
      msg: 'request',
      method: 'GET',
      route: '/api/content/:modelKey',
      path: '/api/content/articles',
      status: 200,
      principal: 'token',
    });
    expect(line?.reqId).toEqual(expect.any(String));
    expect(line?.site).toEqual(expect.any(String));
    expect(line?.ms).toEqual(expect.any(Number));
    expect(Number.isInteger((line?.ms as number) * 10)).toBe(true);
    expect(line).not.toHaveProperty('code');
    // No query string, host or remote address.
    expect(JSON.stringify(line)).not.toContain('filters');
    expect(line).not.toHaveProperty('req');
    expect(line).not.toHaveProperty('remoteAddress');
  });

  it('writes no info line for the readiness and health probes', async () => {
    for (const url of ['/api/ready', '/api/health']) {
      const { statusCode, lines } = await linesOf(infoApp, infoLogs, url, null);
      expect(statusCode).toBe(200);
      expect(lines).toHaveLength(0);
    }
  });

  it('carries the error code on the response line, without a separate rejection line', async () => {
    const unknownModel = await linesOf(infoApp, infoLogs, '/api/content/missing');
    expect(unknownModel.statusCode).toBe(404);
    expect(unknownModel.lines).toHaveLength(1);
    expect(unknownModel.lines[0]).toMatchObject({ status: 404, code: 'MODEL_NOT_FOUND', msg: 'request' });

    const unknownRoute = await linesOf(infoApp, infoLogs, '/api/nowhere?token=secret', null);
    expect(unknownRoute.statusCode).toBe(404);
    expect(unknownRoute.lines).toHaveLength(1);
    expect(unknownRoute.lines[0]).toMatchObject({ status: 404, code: 'NOT_FOUND', path: '/api/nowhere' });
    expect(unknownRoute.lines[0]).not.toHaveProperty('route');

    const anonymous = await linesOf(infoApp, infoLogs, '/api/admin/models', null);
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.lines).toEqual([
      expect.objectContaining({ status: 401, code: 'UNAUTHENTICATED', principal: 'anonymous' }),
    ]);
  });

  it('adds the request-start line at debug, with the redacted URL', async () => {
    const { lines } = await linesOf(debugApp, debugLogs, '/api/content/articles?filters[title][$eq]=Hello');
    expect(lines.map((line) => [line.level, line.msg])).toEqual([
      [DEBUG, 'incoming request'],
      [INFO, 'request'],
    ]);
    const [start, end] = lines;
    expect(start?.req).toMatchObject({ method: 'GET' });
    expect((start?.req as { url?: string } | undefined)?.url).toMatch(/^\/api\/content\/articles\?/);
    expect(start?.req).toHaveProperty('remoteAddress');
    expect(start?.reqId).toBe(end?.reqId);
    expect(JSON.stringify(lines)).not.toContain(token);

    const secretInQuery = await linesOf(debugApp, debugLogs, '/api/nowhere?token=secret-value', null);
    expect(secretInQuery.lines.map((line) => line.msg)).toEqual(['incoming request', 'request']);
    expect(secretInQuery.lines[0]?.req).toMatchObject({ url: '/api/nowhere?token=%5Bredacted%5D' });
    expect(JSON.stringify(secretInQuery.lines)).not.toContain('secret-value');

    const rejected = await linesOf(debugApp, debugLogs, '/api/content/articles?unknown=1');
    expect(rejected.statusCode).toBe(400);
    expect(rejected.lines.map((line) => [line.level, line.msg])).toEqual([
      [DEBUG, 'incoming request'],
      [DEBUG, 'request rejected'],
      [INFO, 'request'],
    ]);

    const probe = await linesOf(debugApp, debugLogs, '/api/ready', null);
    expect(probe.lines.map((line) => [line.level, line.msg])).toEqual([
      [DEBUG, 'incoming request'],
      [DEBUG, 'request'],
    ]);
  });
});
