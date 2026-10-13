import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SchemaDefinition } from '@shapio/schema';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readLocalFiles, writeDefinitionFile } from './files.js';
import { formatItem } from './format.js';
import { collectNames, collectParents } from './sync.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const collection = (n: number, apiKey: string, fields: Array<[number, string]>, parent?: number) =>
  ({
    id: id(n),
    kind: 'collection',
    apiKey,
    pluralApiKey: `${apiKey}s`,
    label: apiKey,
    localized: false,
    draftAndPublish: true,
    ...(parent === undefined ? {} : { extends: id(parent) }),
    fields: fields.map(([fieldN, fieldKey]) => ({
      id: id(fieldN),
      apiKey: fieldKey,
      label: fieldKey,
      type: 'string',
    })),
  }) as unknown as SchemaDefinition;

/** Post (title, summary) in the shared folder, and Guide (level) on the blog site, extending it. */
const POST = collection(1, 'post', [
  [11, 'title'],
  [12, 'summary'],
]);
const GUIDE = collection(2, 'guide', [[21, 'level']], 1);

describe('schema files of a family (plan polymorphic-types)', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'shapio-family-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('pull writes "extends" as the parent’s stable ID, and the file reads back as a valid definition', async () => {
    const path = await writeDefinitionFile(dir, GUIDE, null);
    expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({ extends: id(1) });
    const [file] = await readLocalFiles(dir);
    expect(file?.id).toBe(id(2));
    expect(file?.hash).toBeDefined();
  });

  it('names inherited fields from the parent’s file, across every folder of the tree', async () => {
    await writeDefinitionFile(dir, POST, null);
    await writeDefinitionFile(dir, GUIDE, 'blog');
    const files = await readLocalFiles(dir);
    const names = collectNames(files);
    // The child's file holds only `level`; `summary` is named by the parent's file.
    expect(names.get(id(12))).toBe('summary');
    expect(names.get(id(21))).toBe('level');
    expect(names.get(id(1))).toBe('post');
    expect(collectParents(files)).toEqual(
      new Map([
        [id(2), id(1)],
        ['apiKey:guide', id(1)],
      ]),
    );
  });

  it('names the parent of a new file that has no ID yet', () => {
    const files = [
      { path: 'product.json', site: null, raw: { id: id(1), apiKey: 'product' } },
      { path: 'service.json', site: null, raw: { apiKey: 'service', extends: id(1) } },
    ];
    const item = {
      definitionId: id(9),
      apiKey: 'service',
      kind: 'collection' as const,
      decision: { action: 'create' as const },
      changes: [],
    };
    expect(formatItem(item, collectNames(files), collectParents(files))).toBe(
      'model service (extends product): create',
    );
  });

  it('ignores an empty or missing "extends"', () => {
    const files = [
      { path: 'a.json', site: null, raw: { id: 'a', apiKey: 'a', extends: '' } },
      { path: 'b.json', site: null, raw: { id: 'b', apiKey: 'b' } },
    ];
    expect(collectParents(files).size).toBe(0);
  });
});
