import type { ComponentDefinitionInput, ModelDefinitionInput } from '@shapio/schema';
import { describe, expect, it, vi } from 'vitest';
import { createClient } from '../client.js';
import { ShapioApiError } from '../errors.js';

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const setup = (status = 200, body: unknown = {}) => {
  const fetch = vi.fn(async () => jsonResponse(status, body));
  const client = createClient({ baseUrl: 'https://cms.test/cms', fetch });
  const call = (index = 0) => {
    const [url, init] = fetch.mock.calls[index] as unknown as [string, RequestInit];
    const body: unknown = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    return { url, method: init.method, body };
  };
  return { client, call };
};

const DEFINITION: ModelDefinitionInput = {
  kind: 'collection',
  apiKey: 'article',
  label: 'Article',
  fields: [],
};
const COMPONENT: ComponentDefinitionInput = { kind: 'component', apiKey: 'hero', label: 'Hero', fields: [] };

describe('schema api: definitions', () => {
  it('lists models and components from their own endpoints, unwrapping items', async () => {
    const { client, call } = setup(200, { items: [{ version: 1 }] });
    await expect(client.admin.models.list()).resolves.toEqual([{ version: 1 }]);
    await client.admin.components.list();
    expect(call(0).url).toBe('https://cms.test/cms/api/admin/models');
    expect(call(1).url).toBe('https://cms.test/cms/api/admin/components');
  });

  it('plans and applies an update with the expected version and acknowledgements', async () => {
    const { client, call } = setup();
    await client.admin.models.planUpdate('m/1', { definition: DEFINITION, expectedVersion: 3 });
    await client.admin.models.update('m/1', {
      definition: DEFINITION,
      expectedVersion: 3,
      acknowledgeBreaking: true,
    });
    expect(call(0)).toEqual({
      url: 'https://cms.test/cms/api/admin/models/m%2F1/plan',
      method: 'POST',
      body: { definition: DEFINITION, expectedVersion: 3 },
    });
    expect(call(1)).toEqual({
      url: 'https://cms.test/cms/api/admin/models/m%2F1',
      method: 'PUT',
      body: { definition: DEFINITION, expectedVersion: 3, acknowledgeBreaking: true },
    });
  });

  it('creates, previews a create and deletes with the version in the query', async () => {
    const { client, call } = setup();
    await client.admin.components.planCreate(COMPONENT);
    await client.admin.components.create({ definition: COMPONENT });
    await client.admin.components.remove('c1', 4);
    expect(call(0).url).toBe('https://cms.test/cms/api/admin/components/plan');
    expect(call(0).body).toEqual({ definition: COMPONENT });
    expect(call(1)).toMatchObject({ url: 'https://cms.test/cms/api/admin/components', method: 'POST' });
    expect(call(2)).toMatchObject({
      url: 'https://cms.test/cms/api/admin/components/c1?expectedVersion=4',
      method: 'DELETE',
    });
  });

  it('surfaces a stale version as a 409 ShapioApiError with its details', async () => {
    const { client } = setup(409, {
      error: { code: 'SCHEMA_VERSION_CONFLICT', message: 'stale', details: { currentVersion: 4 } },
    });
    const failure = client.admin.models.update('m1', { definition: DEFINITION, expectedVersion: 3 });
    await expect(failure).rejects.toBeInstanceOf(ShapioApiError);
    await expect(failure).rejects.toMatchObject({
      status: 409,
      code: 'SCHEMA_VERSION_CONFLICT',
      details: { currentVersion: 4 },
    });
  });
});

describe('schema api: summary, changes, settings', () => {
  it('reads the summary, a change and the lock settings', async () => {
    const { client, call } = setup();
    await client.admin.schema.summary();
    await client.admin.schema.change('chg-1');
    await client.admin.schema.settings();
    await client.admin.schema.updateSettings({ readOnly: true, readOnlyReason: 'CI only' });
    expect(call(0).url).toBe('https://cms.test/cms/api/admin/schema');
    expect(call(1).url).toBe('https://cms.test/cms/api/admin/schema/changes/chg-1');
    expect(call(2).url).toBe('https://cms.test/cms/api/admin/schema/settings');
    expect(call(3)).toMatchObject({ method: 'PUT', body: { readOnly: true, readOnlyReason: 'CI only' } });
  });
});

describe('schema api: locales', () => {
  it('creates, updates, sets the default and deletes locales', async () => {
    const { client, call } = setup();
    await client.admin.locales.create({ code: 'fr', label: 'French', fallbacks: ['en'] });
    await client.admin.locales.update('fr-CA', { label: 'Canadian French', fallbacks: ['fr'] });
    await client.admin.locales.setDefault('fr', true);
    await client.admin.locales.remove('fr', false);
    await client.admin.locales.remove('fr', true);
    expect(call(0)).toMatchObject({ url: 'https://cms.test/cms/api/admin/locales', method: 'POST' });
    expect(call(1)).toMatchObject({
      url: 'https://cms.test/cms/api/admin/locales/fr-CA',
      method: 'PUT',
      body: { label: 'Canadian French', fallbacks: ['fr'] },
    });
    expect(call(2)).toEqual({
      url: 'https://cms.test/cms/api/admin/locales/fr/default',
      method: 'POST',
      body: { acknowledgeBreaking: true },
    });
    expect(call(3)).toMatchObject({ url: 'https://cms.test/cms/api/admin/locales/fr', method: 'DELETE' });
    expect(call(4).url).toBe('https://cms.test/cms/api/admin/locales/fr?acknowledgeDestructive=true');
  });
});
