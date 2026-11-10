import { compileLens, normalizeDefinition, type DefinitionInputWithIds, type LensSide } from '@shapio/schema';
import { describe, expect, it } from 'vitest';
import { resolveModelById, type ContentModel } from '../content/model.js';
import type { Policy } from '../permissions/types.js';
import type { RequestLens } from '../schema/lens/views.js';
import { buildSnapshot, type SchemaSnapshot } from '../schema/snapshot.js';
import { lensReadLimit, restFieldReads } from './restFieldReads.js';

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const AUTHOR = uuid(1);
const ARTICLE = uuid(2);
const ids = {
  name: uuid(11),
  bio: uuid(12),
  title: uuid(21),
  writer: uuid(22),
  extra: uuid(23),
  flag: uuid(24),
};

const viewOf = (definitions: Record<string, unknown>[]): SchemaSnapshot =>
  buildSnapshot(
    1,
    definitions.map((definition) => ({
      definition: normalizeDefinition(definition as DefinitionInputWithIds),
      version: 1,
      revisionId: uuid(99),
      hash: 'stored',
      activatedAt: new Date(0),
      siteId: null,
    })),
    [],
  );

const writer = {
  id: ids.writer,
  apiKey: 'writer',
  label: 'Writer',
  type: 'relation',
  settings: { target: AUTHOR, cardinality: 'one' },
};

/** The client's version: article { title, writer, flag (boolean) }, author { name }. */
const clientView = viewOf([
  {
    id: AUTHOR,
    kind: 'collection',
    apiKey: 'author',
    label: 'Author',
    fields: [{ id: ids.name, apiKey: 'name', label: 'Name', type: 'string' }],
  },
  {
    id: ARTICLE,
    kind: 'collection',
    apiKey: 'article',
    label: 'Article',
    fields: [
      { id: ids.title, apiKey: 'title', label: 'Title', type: 'string' },
      writer,
      { id: ids.flag, apiKey: 'flag', label: 'Flag', type: 'boolean' },
    ],
  },
]);

/** Today: title renamed, extra added, flag now a date (no value reads back), author gained bio. */
const current = viewOf([
  {
    id: AUTHOR,
    kind: 'collection',
    apiKey: 'author',
    label: 'Author',
    fields: [
      { id: ids.name, apiKey: 'name', label: 'Name', type: 'string' },
      { id: ids.bio, apiKey: 'bio', label: 'Bio', type: 'text' },
    ],
  },
  {
    id: ARTICLE,
    kind: 'collection',
    apiKey: 'article',
    label: 'Article',
    fields: [
      { id: ids.title, apiKey: 'headline', label: 'Title', type: 'string' },
      writer,
      { id: ids.extra, apiKey: 'extra', label: 'Extra', type: 'string' },
      { id: ids.flag, apiKey: 'flag', label: 'Flag', type: 'date' },
    ],
  },
]);

const sideOf = (view: SchemaSnapshot): LensSide => ({
  get: (id) => view.byId.get(id)?.definition,
  resolve: view.resolve,
});

// Only `lensFor` is read by the usage helpers.
const lens = {
  lensFor: (id: string) => compileLens(sideOf(current), sideOf(clientView), id),
} as unknown as RequestLens;

const policy: Policy = {
  allowed: true,
  rowFilter: null,
  readMask: { mode: 'all' },
  rowReadMasks: null,
  writeMask: { mode: 'all' },
  rowWriteMasks: null,
};

const article = resolveModelById(current, ARTICLE) as ContentModel;
const populate = new Map([[ids.writer, new Map()]]);

const readsOf = (limitTo?: ReadonlySet<string>) =>
  restFieldReads({
    snapshot: current,
    model: article,
    policy,
    query: { fields: null, populate },
    policyFor: () => Promise.resolve(policy),
    ...(limitTo ? { limitTo } : {}),
  });

describe('REST field reads through a schema version', () => {
  it('limits a lensed read to the fields the client knows and reads, populated targets included', () => {
    const limit = lensReadLimit(lens, current, article, populate);
    expect([...(limit ?? [])].sort()).toEqual([ids.name, ids.title, ids.writer].sort());
    expect(lensReadLimit(undefined, current, article, populate)).toBeUndefined();
  });

  it('counts only the limited fields, still as a whole-model (implicit) read', async () => {
    expect(await readsOf(lensReadLimit(lens, current, article, populate))).toEqual([
      { path: ids.title, selection: 'implicit' },
      { path: ids.writer, selection: 'implicit' },
      { path: `${ids.writer}.${ids.name}`, selection: 'implicit' },
    ]);
  });

  it('counts every field without a limit', async () => {
    expect((await readsOf()).map((read) => read.path)).toEqual([
      ids.title,
      ids.writer,
      ids.extra,
      ids.flag,
      `${ids.writer}.${ids.name}`,
      `${ids.writer}.${ids.bio}`,
    ]);
  });
});
