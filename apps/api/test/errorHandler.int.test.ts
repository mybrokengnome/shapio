import { Type } from 'typebox';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppError } from '../src/helpers/appError.js';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import { useTestDatabase } from './helpers/testDatabase.js';

describe('central error handler', () => {
  const database = useTestDatabase();
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp(database.current, {
      register: (app) => {
        app.get('/test/app-error', async () => {
          throw new AppError(409, 'VERSION_CONFLICT', 'The model changed', { expected: 3, actual: 4 });
        });
        app.get('/test/crash', async () => {
          throw new Error('secret internal detail: password=hunter2');
        });
        app.get('/test/csrf', async () => {
          // The shape @fastify/csrf-protection's errors have (@fastify/error, code + statusCode).
          throw Object.assign(new Error('Invalid csrf token'), {
            code: 'FST_CSRF_INVALID_TOKEN',
            statusCode: 403,
          });
        });
        app.post(
          '/test/validated',
          {
            schema: { body: Type.Object({ name: Type.String({ minLength: 1 }) }) },
            config: { audit: { exempt: 'test route' } },
          },
          async () => ({ ok: true }),
        );
      },
    });
  });
  afterAll(() => testApp.app.close());

  it('renders AppError with its code, status and details', async () => {
    const response = await testApp.app.inject({ method: 'GET', url: '/test/app-error' });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: { code: 'VERSION_CONFLICT', message: 'The model changed', details: { expected: 3, actual: 4 } },
    });
  });

  it('hides internal error messages behind INTERNAL_ERROR', async () => {
    const response = await testApp.app.inject({ method: 'GET', url: '/test/crash' });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
    expect(response.body).not.toContain('hunter2');
  });

  it('renders CSRF failures as CSRF_INVALID', async () => {
    const response = await testApp.app.inject({ method: 'GET', url: '/test/csrf' });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({
      error: { code: 'CSRF_INVALID', message: 'Missing or invalid CSRF token' },
    });
  });

  it('renders schema validation failures as VALIDATION_ERROR with details', async () => {
    const response = await testApp.app.inject({
      method: 'POST',
      url: '/test/validated',
      payload: { name: '' },
    });
    expect(response.statusCode).toBe(400);
    const body = response.json<{ error: { code: string; details: unknown[] } }>();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details).toEqual([expect.objectContaining({ instancePath: '/name' })]);
  });
});
