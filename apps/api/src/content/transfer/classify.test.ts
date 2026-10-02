import { describe, expect, it } from 'vitest';
import { classifyEntry } from './classify.js';
import { orderParentsFirst } from './export.js';
import type { EntryRecord } from './format.js';
import { parseRecord } from './format.js';

const MODEL = '0b6f8c2e-3c2a-4d7e-9a1b-2c3d4e5f6a7b';
const R1 = '00000000-0000-4000-8000-000000000001';
const R2 = '00000000-0000-4000-8000-000000000002';
const R3 = '00000000-0000-4000-8000-000000000003';

const head = (
  state: 'draft' | 'published',
  revisionId: string,
  data: Record<string, unknown> = { f: 1 },
) => ({
  locale: 'en',
  state,
  revisionId,
  data,
  autosavedAt: null,
  version: 1,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  publishedAt: null,
});

const revision = (id: string, parentRevisionId: string | null) => ({
  id,
  locale: 'en',
  parentRevisionId,
  reason: 'save' as const,
  data: { f: 1 },
  createdAt: '2026-10-01T00:00:00.000Z',
});

const entry = (heads: EntryRecord['heads'], revisions: EntryRecord['revisions'] = []) => ({
  modelId: MODEL,
  heads,
  revisions,
});

const target = (
  state: string,
  revisionId: string,
  data: Record<string, unknown> = { f: 1 },
  autosaved = false,
) => ({
  entry_id: 'e',
  locale: 'en',
  state,
  revision_id: revisionId,
  data,
  autosaved_at: autosaved ? new Date() : null,
  version: 1,
});

const live = { model_id: MODEL, deleted_at: null };

describe('classifyEntry', () => {
  it('adds entries the target lacks', () => {
    expect(classifyEntry(entry([head('draft', R2)]), undefined, [])).toEqual({ kind: 'added' });
  });

  it('leaves identical entries unchanged, whatever the key order of their data', () => {
    const bundle = entry([head('draft', R2, { a: 1, b: { c: 2, d: 3 } })]);
    expect(classifyEntry(bundle, live, [target('draft', R2, { b: { d: 3, c: 2 }, a: 1 })])).toEqual({
      kind: 'unchanged',
    });
  });

  it('fast-forwards a target still at a revision the bundle knows', () => {
    const bundle = entry([head('draft', R2), head('published', R2)], [revision(R1, null), revision(R2, R1)]);
    expect(classifyEntry(bundle, live, [target('draft', R1)])).toEqual({ kind: 'updated' });
  });

  it('treats a headless entry row (created by the import itself) as an update', () => {
    expect(classifyEntry(entry([head('draft', R2)]), live, [])).toEqual({ kind: 'updated' });
  });

  it('reports target revisions the bundle does not know, autosaves on top, other models and deletions', () => {
    const bundle = entry([head('draft', R2)], [revision(R1, null), revision(R2, R1)]);
    expect(classifyEntry(bundle, live, [target('draft', R3)])).toMatchObject({
      kind: 'conflict',
      reason: 'changedOnTarget',
    });
    expect(classifyEntry(bundle, live, [target('draft', R1, { f: 9 }, true)])).toMatchObject({
      kind: 'conflict',
      reason: 'changedOnTarget',
    });
    expect(classifyEntry(bundle, { model_id: R3, deleted_at: null }, [])).toMatchObject({
      kind: 'conflict',
      reason: 'otherModel',
    });
    expect(classifyEntry(bundle, { model_id: MODEL, deleted_at: new Date() }, [])).toMatchObject({
      kind: 'conflict',
      reason: 'deletedOnTarget',
    });
  });
});

describe('orderParentsFirst', () => {
  const row = (id: string, parent: string | null, at: string) => ({
    id,
    entry_id: 'e',
    locale: 'en',
    parent_revision_id: parent,
    reason: 'save',
    data: {},
    author_type: 'admin',
    created_at: new Date(at),
  });

  it('puts parents before children even when timestamps tie, and drops links to missing parents', () => {
    const ordered = orderParentsFirst([
      row(R3, R2, '2026-10-01T00:00:00Z'),
      row(R2, R1, '2026-10-01T00:00:00Z'),
      row(R1, '00000000-0000-4000-8000-000000000009', '2026-10-01T00:00:00Z'),
    ]);
    expect(ordered.map((revision) => revision.id)).toEqual([R1, R2, R3]);
    expect(ordered[0]?.parentRevisionId).toBeNull();
  });
});

describe('parseRecord', () => {
  it('rejects unknown record types and invalid records with the line number', () => {
    expect(() => parseRecord('{"type":"secret"}', 3)).toThrow('Bundle line 3: unknown record type "secret"');
    expect(() => parseRecord('{"type":"locale","code":"en"}', 4)).toThrow(/Bundle line 4: locale/);
    expect(() => parseRecord('not json', 5)).toThrow('Bundle line 5: not valid JSON');
  });

  it('accepts only argon2 hashes as app-user passwords', () => {
    const user = {
      type: 'appUser',
      id: R1,
      email: 'a@example.com',
      name: '',
      passwordHash: 'hunter2',
      confirmedAt: null,
      blockedAt: null,
      passwordChangedAt: null,
      createdAt: '2026-10-01T00:00:00Z',
      updatedAt: '2026-10-01T00:00:00Z',
      roleKeys: [],
      oauthAccounts: [],
    };
    expect(() => parseRecord(JSON.stringify(user), 1)).toThrow(/passwordHash/);
    expect(parseRecord(JSON.stringify({ ...user, passwordHash: '$argon2id$v=19$m=1$x$y' }), 1)).toMatchObject(
      {
        type: 'appUser',
      },
    );
  });
});
