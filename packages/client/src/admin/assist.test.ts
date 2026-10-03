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
    const parsed: unknown = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    return { url, method: init.method, body: parsed };
  };
  return { client, call };
};

describe('assist api', () => {
  it('reads the status', async () => {
    const { client, call } = setup(200, { enabled: true, provider: 'openai', model: 'm' });
    await expect(client.admin.assist.status()).resolves.toEqual({
      enabled: true,
      provider: 'openai',
      model: 'm',
    });
    expect(call()).toMatchObject({ url: 'https://cms.test/cms/api/admin/assist/status', method: 'GET' });
  });

  it('posts each action to its path with the body as given', async () => {
    const { client, call } = setup(200, {});
    await client.admin.assist.altText({ assetId: 'a1', locale: 'fr' });
    await client.admin.assist.summarize({ modelKey: 'article', entryId: 'e1', fieldApiKey: 'excerpt' });
    await client.admin.assist.translate({ modelKey: 'article', entryId: 'e1', from: 'en', to: 'fr' });
    await client.admin.assist.rewrite({ text: 'Hello', instruction: 'Shorten' });
    await client.admin.assist.schemaDraft({ description: 'A recipe' });
    await client.admin.assist.proposeContentOps({ rule: 'altMissing' });
    expect([0, 1, 2, 3, 4, 5].map((index) => [call(index).method, call(index).url])).toEqual([
      ['POST', 'https://cms.test/cms/api/admin/assist/alt-text'],
      ['POST', 'https://cms.test/cms/api/admin/assist/summarize'],
      ['POST', 'https://cms.test/cms/api/admin/assist/translate'],
      ['POST', 'https://cms.test/cms/api/admin/assist/rewrite'],
      ['POST', 'https://cms.test/cms/api/admin/assist/schema/draft'],
      ['POST', 'https://cms.test/cms/api/admin/assist/content-ops/propose'],
    ]);
    expect(call(2).body).toEqual({ modelKey: 'article', entryId: 'e1', from: 'en', to: 'fr' });
    expect(call(3).body).toEqual({ text: 'Hello', instruction: 'Shorten' });
  });

  it('reads a content-ops run by its encoded ID', async () => {
    const { client, call } = setup(200, { runId: 'r 1', status: 'queued' });
    await client.admin.assist.contentOpsRun('r 1');
    expect(call().url).toBe('https://cms.test/cms/api/admin/assist/content-ops/r%201');
  });

  it('throws the server error with its code', async () => {
    const { client } = setup(502, { error: { code: 'ASSIST_PROVIDER_ERROR', message: 'Provider failed' } });
    await expect(client.admin.assist.rewrite({ text: 'a', instruction: 'b' })).rejects.toMatchObject(
      new ShapioApiError(502, { error: { code: 'ASSIST_PROVIDER_ERROR', message: 'Provider failed' } }),
    );
  });
});
