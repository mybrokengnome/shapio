import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SchemaDefinition } from '@shapio/schema';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readLocalFiles, writeDefinitionFile } from './files.js';
import { formatItem } from './format.js';
import { collectImplemented, collectNames, collectParents } from './sync.js';

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

/** Featurable (title) shared, and Post implementing it. */
const FEATURABLE = {
  id: id(5),
  kind: 'interface',
  apiKey: 'featurable',
  pluralApiKey: 'featurables',
  label: 'Featurable',
  display: { titleFieldId: id(51) },
  fields: [{ id: id(51), apiKey: 'title', label: 'Title', type: 'string', required: true }],
} as unknown as SchemaDefinition;
const FEATURED_POST = { ...POST, implements: [id(5)] } as SchemaDefinition;

describe('schema files of interfaces (plan interfaces)', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'shapio-interfaces-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('pull writes an interface to interfaces/, and a type’s "implements" as stable IDs; both read back', async () => {
    const interfacePath = await writeDefinitionFile(dir, FEATURABLE, null);
    const sitePath = await writeDefinitionFile(dir, FEATURABLE, 'blog');
    const postPath = await writeDefinitionFile(dir, FEATURED_POST, null);
    expect(interfacePath).toBe(join(dir, 'interfaces', 'featurable.json'));
    expect(sitePath).toBe(join(dir, 'sites', 'blog', 'interfaces', 'featurable.json'));
    expect(JSON.parse(await readFile(postPath, 'utf8'))).toMatchObject({ implements: [id(5)] });
    const files = await readLocalFiles(dir);
    const read = files.find((file) => file.path === interfacePath);
    expect(read).toMatchObject({ id: id(5), site: null });
    expect(read?.hash).toBeDefined();
    expect(files.find((file) => file.path === sitePath)?.site).toBe('blog');
  });

  it('names interfaces and their contract fields, and what each type implements', async () => {
    await writeDefinitionFile(dir, FEATURABLE, null);
    await writeDefinitionFile(dir, FEATURED_POST, null);
    const files = await readLocalFiles(dir);
    const names = collectNames(files);
    expect(names.get(id(5))).toBe('featurable');
    expect(names.get(id(51))).toBe('title');
    expect(collectImplemented(files)).toEqual(
      new Map([
        [id(1), [id(5)]],
        ['apiKey:post', [id(5)]],
      ]),
    );
    const item = {
      definitionId: id(1),
      apiKey: 'post',
      kind: 'collection' as const,
      decision: { action: 'update' as const, expectedVersion: 2 },
      changes: [],
    };
    expect(formatItem(item, names, collectParents(files), collectImplemented(files))).toBe(
      'model post (implements featurable): update',
    );
  });

  it('ignores an empty or malformed "implements"', () => {
    const files = [
      { path: 'a.json', site: null, raw: { id: 'a', apiKey: 'a', implements: [] } },
      { path: 'b.json', site: null, raw: { id: 'b', apiKey: 'b', implements: 'x' } },
      { path: 'c.json', site: null, raw: { id: 'c', apiKey: 'c', implements: [1, ''] } },
    ];
    expect(collectImplemented(files).size).toBe(0);
  });
});
