import { normalizeDefinition, type DefinitionInput, type SchemaDefinition } from '@shapio/schema';
import {
  assertValidSchema,
  isInputObjectType,
  isObjectType,
  isUnionType,
  printSchema,
  type GraphQLSchema,
} from 'graphql';
import { describe, expect, it } from 'vitest';
import {
  DENIED_POLICY,
  type PermissionEvaluator,
  type Policy,
  type PolicyRequest,
  type Principal,
} from '../../../permissions/types.js';
import { buildSnapshot, type ActiveDefinition } from '../../snapshot.js';
import { buildGraphqlSchema } from './schemaBuilder.js';
import { FULL_VISIBILITY, resolveSchemaVisibility, type SchemaVisibility } from './visibility.js';

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

const IDS = {
  card: uuid(1),
  hidden: uuid(2),
  author: uuid(3),
  article: uuid(4),
  submission: uuid(5),
  title: uuid(41),
  internalNote: uuid(42),
  authorRel: uuid(43),
  cardField: uuid(44),
  sections: uuid(45),
  email: uuid(51),
  notes: uuid(52),
} as const;

const card = define({
  id: IDS.card,
  kind: 'component',
  apiKey: 'card',
  label: 'Card',
  fields: [
    { id: uuid(11), apiKey: 'heading', label: 'Heading', type: 'string' },
    { id: uuid(12), apiKey: 'cardSecret', label: 'Card secret', type: 'string', public: false },
  ],
});
const hidden = define({
  id: IDS.hidden,
  kind: 'component',
  apiKey: 'hiddenBlock',
  label: 'Hidden block',
  fields: [{ id: uuid(21), apiKey: 'onlySecret', label: 'Only secret', type: 'string', public: false }],
});
const author = define({
  id: IDS.author,
  kind: 'collection',
  apiKey: 'author',
  label: 'Author',
  fields: [{ id: uuid(31), apiKey: 'name', label: 'Name', type: 'string' }],
});
const article = define({
  id: IDS.article,
  kind: 'collection',
  apiKey: 'article',
  label: 'Article',
  fields: [
    { id: IDS.title, apiKey: 'title', label: 'Title', type: 'string', filterable: true, sortable: true },
    {
      id: IDS.internalNote,
      apiKey: 'internalNote',
      label: 'Internal note',
      type: 'string',
      public: false,
      filterable: true,
      sortable: true,
    },
    {
      id: IDS.authorRel,
      apiKey: 'writer',
      label: 'Writer',
      type: 'relation',
      settings: { target: IDS.author, cardinality: 'one' },
    },
    {
      id: IDS.cardField,
      apiKey: 'teaser',
      label: 'Teaser',
      type: 'component',
      settings: { component: IDS.card },
    },
    {
      id: IDS.sections,
      apiKey: 'sections',
      label: 'Sections',
      type: 'dynamiczone',
      settings: { components: [IDS.card, IDS.hidden] },
    },
  ],
});
const submission = define({
  id: IDS.submission,
  kind: 'collection',
  apiKey: 'submission',
  label: 'Submission',
  fields: [
    { id: IDS.email, apiKey: 'email', label: 'Email', type: 'email' },
    { id: IDS.notes, apiKey: 'reviewNotes', label: 'Review notes', type: 'text', public: false },
  ],
});

const snapshot = buildSnapshot(3, [card, hidden, author, article, submission].map(active), [
  { code: 'en', label: 'English', isDefault: true, fallbacks: [] },
] as never);

const allow = (readIds: string[], writeIds: string[] = []): Policy => ({
  allowed: true,
  rowFilter: null,
  readMask: { mode: 'only', fieldIds: readIds, componentFields: 'public' },
  rowReadMasks: null,
  writeMask: { mode: 'only', fieldIds: writeIds, componentFields: 'public' },
  rowWriteMasks: null,
});

/** A fixed evaluator: (action:modelId) → policy; anything else is denied. */
const evaluatorOf = (policies: Record<string, Policy>): PermissionEvaluator => ({
  evaluate: (_principal: Principal, request: PolicyRequest) =>
    Promise.resolve(policies[`${request.action}:${request.modelId}`] ?? DENIED_POLICY),
  canPerform: () => Promise.resolve(false),
  canPerformOnSite: () => Promise.resolve(false),
});

const DELIVERY: Principal = { kind: 'token', tokenId: 't', scope: 'delivery', roleId: 'r', siteId: 's' };
const ANONYMOUS: Principal = { kind: 'anonymous', siteId: 's' };
const ADMIN_TOKEN: Principal = { kind: 'token', tokenId: 't', scope: 'admin', roleId: 'r', siteId: null };

/** A delivery reader of `article`'s public fields, and an anonymous caller that may only create submissions. */
const PUBLIC_READER = {
  [`read:${IDS.article}`]: allow([IDS.title, IDS.authorRel, IDS.cardField, IDS.sections]),
  [`create:${IDS.submission}`]: allow([], [IDS.email]),
};

const fieldNames = (schema: GraphQLSchema, typeName: string): string[] => {
  const type = schema.getType(typeName);
  return isObjectType(type) || isInputObjectType(type) ? Object.keys(type.getFields()) : [];
};

const build = async (policies: Record<string, Policy>, principal: Principal = DELIVERY) => {
  const visibility = await resolveSchemaVisibility(snapshot, evaluatorOf(policies), principal);
  return { visibility, schema: buildGraphqlSchema(snapshot, visibility).schema };
};

describe('GraphQL schema visibility', () => {
  it('leaves every name a delivery caller cannot read out of its schema', async () => {
    const { schema } = await build(PUBLIC_READER);
    expect(() => assertValidSchema(schema)).not.toThrow();
    const printed = printSchema(schema);
    for (const hiddenName of [
      'internalNote',
      'cardSecret',
      'onlySecret',
      'HiddenBlock',
      'Author',
      'reviewNotes',
    ]) {
      expect(printed).not.toContain(hiddenName);
    }
    // The relation to a model the caller cannot read is absent (REST keeps the key, always empty).
    expect(fieldNames(schema, 'Article')).not.toContain('writer');
    expect(fieldNames(schema, 'Article')).toEqual(
      expect.arrayContaining(['id', 'title', 'teaser', 'sections']),
    );
    expect(fieldNames(schema, 'ArticleFilter')).not.toContain('internalNote');
    expect(fieldNames(schema, 'ArticleSort')).not.toContain('internalNote');
    expect(fieldNames(schema, 'Card')).toEqual(['heading']);
    // A zone member the caller sees no field of is dropped from the union.
    const zone = schema.getType('ArticleSectionsZone');
    expect(isUnionType(zone) && zone.getTypes().map((type) => type.name)).toEqual(['Card']);
    // The article input holds only written fields: this caller writes none, so `data` is gone.
    expect(schema.getType('ArticleInput')).toBeUndefined();
  });

  it('gives a write-only model its mutations with a masked input and no read queries or type', async () => {
    const { schema } = await build(PUBLIC_READER);
    const query = Object.keys(schema.getQueryType()?.getFields() ?? {});
    expect(query).toEqual(expect.arrayContaining(['article', 'articles']));
    expect(query).not.toContain('submission');
    expect(query).not.toContain('submissions');
    expect(schema.getType('Submission')).toBeUndefined();
    expect(Object.keys(schema.getMutationType()?.getFields() ?? {})).toContain('createSubmission');
    expect(fieldNames(schema, 'SubmissionInput')).toEqual(['email']);
  });

  it('shows a non-public field a grant names, top level only', async () => {
    const { schema } = await build({
      [`read:${IDS.article}`]: allow([IDS.title, IDS.internalNote, IDS.cardField]),
    });
    expect(fieldNames(schema, 'Article')).toContain('internalNote');
    expect(fieldNames(schema, 'ArticleFilter')).toContain('internalNote');
    expect(fieldNames(schema, 'Card')).toEqual(['heading']);
  });

  it('gives the same key to the same masks and another key to other masks', async () => {
    const a = (await build(PUBLIC_READER)).visibility;
    const b = (await build(PUBLIC_READER, ANONYMOUS)).visibility;
    const c = (await build({ ...PUBLIC_READER, [`read:${IDS.author}`]: allow([uuid(31)]) })).visibility;
    expect(a.key).toBe(b.key);
    expect(c.key).not.toBe(a.key);
    expect(a.key).not.toBe(FULL_VISIBILITY.key);
  });

  it('gives admin callers the full schema without evaluating any policy', async () => {
    const evaluator = evaluatorOf({});
    let evaluated = 0;
    const counting: PermissionEvaluator = {
      ...evaluator,
      evaluate: (...args) => {
        evaluated += 1;
        return evaluator.evaluate(...args);
      },
    };
    const visibility: SchemaVisibility = await resolveSchemaVisibility(snapshot, counting, ADMIN_TOKEN);
    expect(visibility).toBe(FULL_VISIBILITY);
    expect(evaluated).toBe(0);
    const printed = printSchema(buildGraphqlSchema(snapshot, visibility).schema);
    for (const name of ['internalNote', 'cardSecret', 'onlySecret', 'type Author', 'reviewNotes', 'writer']) {
      expect(printed).toContain(name);
    }
  });

  it('leaves out every model when no policy allows anything', async () => {
    const { schema } = await build({});
    expect(() => assertValidSchema(schema)).not.toThrow();
    expect(Object.keys(schema.getQueryType()?.getFields() ?? {})).not.toContain('article');
    expect(schema.getMutationType()).toBeUndefined();
  });
});
