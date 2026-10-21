import type { DefinitionListItem } from '@shapio/client';
import { createDefinitionIndex, normalizeDefinition, type InterfaceDefinition } from '@shapio/schema';
import { describe, expect, it } from 'vitest';
import { contractFieldCopies, interfacesInScope, membershipsOf, missingContractIssues } from './interfaces';

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

const contract = (id: number, apiKey: string, fields: string[]) =>
  normalizeDefinition({
    id: uuid(id),
    kind: 'interface',
    apiKey,
    label: apiKey,
    fields: fields.map((field, position) => ({
      id: uuid(id * 10 + position),
      apiKey: field,
      label: field,
      type: 'string',
      localized: true,
    })),
  }) as InterfaceDefinition;

const item = (definition: InterfaceDefinition, siteId: string | null): DefinitionListItem => ({
  definition,
  scope: siteId === null ? 'network' : 'site',
  siteId,
  version: 1,
  hash: '',
  revisionId: '',
  activatedAt: '',
  pendingChange: null,
});

describe('interfacesInScope', () => {
  const shared = contract(1, 'shared', []);
  const mine = contract(2, 'mine', []);
  const theirs = contract(3, 'theirs', []);
  const items = [item(theirs, 'b'), item(mine, 'a'), item(shared, null)];

  it('offers a site type the shared interfaces and its own site’s, by label', () => {
    expect(interfacesInScope(items, { scope: 'site', siteId: 'a' }).map(({ apiKey }) => apiKey)).toEqual([
      'mine',
      'shared',
    ]);
  });

  it('offers a shared type the shared interfaces only', () => {
    expect(interfacesInScope(items, { scope: 'network', siteId: 'a' }).map(({ apiKey }) => apiKey)).toEqual([
      'shared',
    ]);
  });
});

describe('contractFieldCopies', () => {
  it('copies each missing contract field once, under a fresh ID, localized only for a localized type', () => {
    const featurable = contract(1, 'featurable', ['title', 'image']);
    const listable = contract(2, 'listable', ['title', 'summary']);
    const copies = contractFieldCopies([featurable, listable], [{ apiKey: 'Image' }], false);
    expect(copies.map(({ apiKey }) => apiKey)).toEqual(['title', 'summary']);
    expect(copies.every(({ id }) => id !== uuid(10) && id !== uuid(20))).toBe(true);
    expect(copies.every(({ localized }) => !localized)).toBe(true);
  });
});

describe('membershipsOf', () => {
  it('lists inherited interfaces with the ancestor they come from, then its own', () => {
    const featurable = contract(1, 'featurable', []);
    const listable = contract(2, 'listable', []);
    const products = normalizeDefinition({
      id: uuid(10),
      kind: 'collection',
      apiKey: 'product',
      label: 'Product',
      implements: [uuid(1)],
      fields: [],
    });
    const digital = normalizeDefinition({
      id: uuid(11),
      kind: 'collection',
      apiKey: 'digital',
      label: 'Digital',
      extends: uuid(10),
      fields: [],
    });
    const index = createDefinitionIndex([featurable, listable, products, digital]);
    expect(membershipsOf(index, uuid(11), [uuid(2)])).toEqual([
      { interfaceId: uuid(1), via: uuid(10) },
      { interfaceId: uuid(2) },
    ]);
  });
});

describe('missingContractIssues', () => {
  it('keeps one missing-field issue per member and field', () => {
    const missing = {
      path: '/implements/0',
      code: 'INTERFACE_FIELD_MISSING',
      message: '"image" is required by Featurable',
      definitionId: 'post',
      interfaceId: 'featurable',
      fieldApiKey: 'image',
    };
    const found = missingContractIssues([
      missing,
      { ...missing, siteKey: 'b' },
      { path: '/label', code: 'API_KEY_INVALID', message: 'nope' },
    ]);
    expect(found).toEqual([{ ...missing, code: 'INTERFACE_FIELD_MISSING' }]);
  });
});
