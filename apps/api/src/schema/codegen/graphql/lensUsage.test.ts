import {
  normalizeDefinition,
  type DefinitionInput,
  type DefinitionLens,
  type SchemaDefinition,
} from '@shapio/schema';
import { describe, expect, it } from 'vitest';
import type { RequestLens } from '../../lens/views.js';
import { buildSnapshot, type ActiveDefinition } from '../../snapshot.js';
import { lensUsage } from './lensUsage.js';
import type { OperationUsage } from './usageSelection.js';
import { FULL_VISIBILITY, type SchemaVisibility } from './visibility.js';

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const define = (input: DefinitionInput & { id: string }): SchemaDefinition =>
  normalizeDefinition(input as Parameters<typeof normalizeDefinition>[0]);
const active = (definition: SchemaDefinition): ActiveDefinition => ({
  definition,
  version: 1,
  revisionId: uuid(900),
  hash: 'h',
  activatedAt: new Date(0),
  siteId: null,
});

const ARTICLE = uuid(1);
const AUTHOR = uuid(2);
const GADGET = uuid(3);
const TITLE = uuid(11);
const SUMMARY = uuid(12);
const WRITER = uuid(13);
const NAME = uuid(21);
const BIO = uuid(22);

const current = buildSnapshot(
  9,
  [
    define({
      id: AUTHOR,
      kind: 'collection',
      apiKey: 'author',
      label: 'Author',
      fields: [
        { id: NAME, apiKey: 'name', label: 'Name', type: 'string' },
        { id: BIO, apiKey: 'bio', label: 'Bio', type: 'string' },
      ],
    }),
    define({
      id: ARTICLE,
      kind: 'collection',
      apiKey: 'article',
      label: 'Article',
      fields: [
        { id: TITLE, apiKey: 'title', label: 'Title', type: 'string' },
        {
          id: WRITER,
          apiKey: 'writer',
          label: 'Writer',
          type: 'relation',
          settings: { target: AUTHOR, cardinality: 'one' },
        },
      ],
    }),
  ].map(active),
  [],
);

/** Lenses by definition: `live` fields read something, `nulled` read null; gadget is gone. */
const lensOf = (id: string, live: string[], nulled: string[]): DefinitionLens =>
  ({
    definitionId: id,
    status: 'lensed',
    fields: [
      ...live.map((fieldId) => ({ kind: 'same', fieldId })),
      ...nulled.map((fieldId) => ({ kind: 'null', fieldId })),
    ],
  }) as unknown as DefinitionLens;
const lens = {
  lensFor: (id: string) =>
    id === ARTICLE
      ? lensOf(ARTICLE, [TITLE, WRITER], [SUMMARY])
      : id === AUTHOR
        ? lensOf(AUTHOR, [NAME], [BIO])
        : id === GADGET
          ? ({ ...lensOf(GADGET, [uuid(31)], []), status: 'gone' } as DefinitionLens)
          : null,
} as unknown as RequestLens;

const read = (path: string) => ({ path, selection: 'explicit' as const });
const usage: OperationUsage = {
  reads: new Map([
    [
      ARTICLE,
      [read(TITLE), read(SUMMARY), read(WRITER), read(`${WRITER}.${NAME}`), read(`${WRITER}.${BIO}`)],
    ],
    [GADGET, [read(uuid(31))]],
  ]),
  snapshot: 4,
};

describe('lensUsage', () => {
  it("counts today's live fields only: never gone or nulled ones, nor a model gone since", () => {
    const counted = lensUsage(usage, lens, current, FULL_VISIBILITY);
    expect(counted.snapshot).toBe(4);
    expect([...counted.reads.keys()]).toEqual([ARTICLE]);
    expect(counted.reads.get(ARTICLE)?.map(({ path }) => path)).toEqual([TITLE, WRITER, `${WRITER}.${NAME}`]);
  });

  it("never counts a field today's visibility hides", () => {
    const visibility: SchemaVisibility = {
      key: 'delivery:x',
      models: new Map([
        [ARTICLE, { readable: true, readFields: new Set([WRITER]), writeFields: new Set() }],
        [AUTHOR, { readable: true, readFields: new Set([NAME]), writeFields: new Set() }],
      ]),
      componentFields: 'public',
    };
    const counted = lensUsage(usage, lens, current, visibility);
    expect(counted.reads.get(ARTICLE)?.map(({ path }) => path)).toEqual([WRITER, `${WRITER}.${NAME}`]);
  });
});
