import { describe, expect, it } from 'vitest';
import { MissingAuditDeclarationError } from '../src/plugins/auditDeclaration.js';
import { createTestApp } from './helpers/createTestApp.js';
import { useTestDatabase } from './helpers/testDatabase.js';

describe('audit declaration check', () => {
  const database = useTestDatabase();

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'] as const)(
    'fails startup for an unannotated %s route',
    async (method) => {
      const startup = createTestApp(database.current, {
        register: (app) => {
          app.route({ method, url: '/test/unannotated', handler: async () => ({}) });
        },
      });
      await expect(startup).rejects.toBeInstanceOf(MissingAuditDeclarationError);
    },
  );

  it('accepts mutating routes that declare an audit action or an exemption, and any GET', async () => {
    const { app } = await createTestApp(database.current, {
      register: (instance) => {
        instance.post('/test/audited', { config: { audit: { action: 'test.create' } } }, async () => ({}));
        instance.delete(
          '/test/exempt',
          { config: { audit: { exempt: 'recorded as a revision' } } },
          async () => ({}),
        );
        instance.get('/test/read', async () => ({}));
      },
    });
    await app.close();
  });

  it('rejects an empty exemption reason', async () => {
    const startup = createTestApp(database.current, {
      register: (app) => {
        app.post('/test/blank', { config: { audit: { exempt: '  ' } } }, async () => ({}));
      },
    });
    await expect(startup).rejects.toBeInstanceOf(MissingAuditDeclarationError);
  });
});
