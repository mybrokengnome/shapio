import { describe, expect, it } from 'vitest';
import { resolveReferences } from './schemaDrafts.js';

const FEATURABLE_ID = '66666666-6666-4666-8666-666666666666';
const LISTABLE_ID = '77777777-7777-4777-8777-777777777777';
const POST_ID = '22222222-2222-4222-8222-222222222222';

const ids = new Map([
  ['featurable', FEATURABLE_ID],
  ['listable', LISTABLE_ID],
  ['post', POST_ID],
]);

const relation = (target: unknown) => ({
  apiKey: 'featured',
  type: 'relation',
  settings: { target, cardinality: 'many' },
});

const targetOf = (definition: ReturnType<typeof resolveReferences>) =>
  (definition.fields[0] as { settings: { target: unknown } }).settings.target;

describe('resolveReferences', () => {
  it('resolves implements given as API IDs, keeps stable IDs, and leaves unknown names for the server', () => {
    const resolved = resolveReferences(
      { kind: 'collection', apiKey: 'post', implements: ['featurable', LISTABLE_ID, 'missing'] },
      ids,
    );
    expect(resolved.implements).toEqual([FEATURABLE_ID, LISTABLE_ID, 'missing']);
  });

  it('leaves a definition without implements as it is', () => {
    expect(resolveReferences({ kind: 'collection', apiKey: 'post' }, ids)).not.toHaveProperty('implements');
  });

  it('resolves a relation target that names an interface by API ID', () => {
    expect(targetOf(resolveReferences({ apiKey: 'home', fields: [relation('featurable')] }, ids))).toBe(
      FEATURABLE_ID,
    );
  });

  it('keeps "*" (any entry) and maps the word "any" to it', () => {
    expect(targetOf(resolveReferences({ apiKey: 'home', fields: [relation('*')] }, ids))).toBe('*');
    expect(targetOf(resolveReferences({ apiKey: 'home', fields: [relation('any')] }, ids))).toBe('*');
  });

  it('prefers a definition whose API ID is "any" over the word', () => {
    const withAny = new Map([...ids, ['any', POST_ID]]);
    expect(targetOf(resolveReferences({ apiKey: 'home', fields: [relation('any')] }, withAny))).toBe(POST_ID);
  });
});
