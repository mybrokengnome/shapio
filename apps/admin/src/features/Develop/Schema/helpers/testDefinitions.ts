import { normalizeDefinition, type ComponentDefinition, type ModelDefinition } from '@shapio/schema';
import type { SchemaExport } from '@/api/schemaFiles';

/** Definitions for the Schema helpers' tests (deterministic stable IDs). */
export const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

export const AUTHOR = normalizeDefinition({
  id: uuid(1),
  kind: 'collection',
  apiKey: 'author',
  label: 'Author',
  fields: [{ id: uuid(11), apiKey: 'name', label: 'Name', type: 'string', required: true }],
}) as ModelDefinition;

export const SEO = normalizeDefinition({
  id: uuid(2),
  kind: 'component',
  apiKey: 'seo',
  label: 'SEO',
  fields: [{ id: uuid(21), apiKey: 'metaTitle', label: 'Meta title', type: 'string' }],
}) as ComponentDefinition;

export const ARTICLE = normalizeDefinition({
  id: uuid(3),
  kind: 'collection',
  apiKey: 'article',
  label: 'Article',
  fields: [
    { id: uuid(31), apiKey: 'title', label: 'Title', type: 'string', required: true, filterable: true },
    { id: uuid(32), apiKey: 'body', label: 'Body', type: 'richtext' },
    {
      id: uuid(33),
      apiKey: 'author',
      label: 'Author',
      type: 'relation',
      settings: { target: uuid(1), cardinality: 'one' },
    },
    { id: uuid(34), apiKey: 'seo', label: 'SEO', type: 'component', settings: { component: uuid(2) } },
    {
      id: uuid(35),
      apiKey: 'stage',
      label: 'Stage',
      type: 'enum',
      settings: { values: [{ value: 'draft', label: 'Draft' }] },
    },
  ],
}) as ModelDefinition;

export const exportOf = (
  entries: ReadonlyArray<{
    definition: ModelDefinition | ComponentDefinition;
    version: number;
    hash: string;
  }>,
  schemaVersion = 7,
): SchemaExport => ({ schemaVersion, definitions: [...entries] });
