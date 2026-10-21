import { normalizeDefinition, type SchemaDefinition } from '@shapio/schema';
import { describe, expect, it } from 'vitest';
import { validateScoped, type ScopedDefinition } from './scopedValidation.js';

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const SITE_A = uuid(70);
const SITE_B = uuid(71);
const siteKeys = new Map([
  [SITE_A, 'a'],
  [SITE_B, 'b'],
]);
const title = (n: number) => ({ id: uuid(n), apiKey: 'title', label: 'Title', type: 'string' as const });
const featurable = normalizeDefinition({
  id: uuid(1),
  kind: 'interface',
  apiKey: 'featurable',
  label: 'Featurable',
  fields: [title(11)],
});
const member = (n: number, apiKey: string) =>
  normalizeDefinition({
    id: uuid(n),
    kind: 'collection',
    apiKey,
    label: apiKey,
    implements: [uuid(1)],
    fields: [title(n * 10 + 1)],
  });
const scoped = (definition: SchemaDefinition, siteId: string | null): ScopedDefinition => ({
  definition,
  siteId,
});
const issues = (proposed: ScopedDefinition[]) =>
  validateScoped(proposed, [null], { siteKeys }).map(
    (found) => `${found.definitionId ?? ''} ${found.path} ${found.code}`,
  );

/** Interfaces across sites (plan interfaces, D3 and decision 2). */
describe('interface scopes', () => {
  it('a shared interface may have members on any site and shared ones', () => {
    expect(
      issues([
        scoped(featurable, null),
        scoped(member(2, 'post'), SITE_A),
        scoped(member(3, 'note'), SITE_B),
        scoped(member(4, 'page'), null),
      ]),
    ).toEqual([]);
  });

  it("a site's interface may be implemented by that site's types only", () => {
    expect(issues([scoped(featurable, SITE_A), scoped(member(2, 'post'), SITE_A)])).toEqual([]);
    const found = validateScoped([scoped(featurable, SITE_A), scoped(member(3, 'note'), SITE_B)], [SITE_B], {
      siteKeys,
    });
    expect(found.map((issue) => `${issue.definitionId ?? ''} ${issue.path} ${issue.code}`)).toEqual([
      `${uuid(3)} /implements/0 INVALID_INTERFACE`,
    ]);
    expect(found[0]?.message).toContain('"featurable" is on site "a" and this type is on site "b"');
  });

  it("a shared type may not implement a site's interface", () => {
    expect(issues([scoped(featurable, SITE_A), scoped(member(4, 'page'), null)])).toEqual([
      `${uuid(4)} /implements/0 INVALID_REFERENCE_TARGET`,
    ]);
  });
});
