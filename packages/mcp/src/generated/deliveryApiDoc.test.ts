import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { DELIVERY_API_DOC } from './deliveryApiDoc.js';

describe('embedded delivery API guide', () => {
  it('matches documentation/delivery-api.md (run `node packages/mcp/scripts/embedDocs.mjs`)', async () => {
    const source = await readFile(
      new URL('../../../../documentation/delivery-api.md', import.meta.url),
      'utf8',
    );
    expect(DELIVERY_API_DOC).toBe(source);
  });
});
