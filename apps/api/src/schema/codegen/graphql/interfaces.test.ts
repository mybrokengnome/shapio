import { ANY_TARGET, normalizeDefinition, type SchemaDefinition } from '@shapio/schema';
import {
  assertValidSchema,
  execute,
  isInputObjectType,
  isInterfaceType,
  isObjectType,
  Kind,
  parse,
  type GraphQLSchema,
  type OperationDefinitionNode,
} from 'graphql';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DENIED_POLICY,
  type PermissionEvaluator,
  type Policy,
  type PolicyRequest,
  type Principal,
} from '../../../permissions/types.js';
import * as contentDeliveryService from '../../../services/contentDelivery.js';
import { buildSnapshot, type ActiveDefinition } from '../../snapshot.js';
import { fragmentsOf } from './complexity.js';
import type { GraphqlContext } from './context.js';
import { buildGraphqlSchema } from './schemaBuilder.js';
import { operationUsage } from './usageSelection.js';
import { resolveSchemaVisibility } from './visibility.js';

vi.mock('../../../services/contentDelivery.js', () => ({ listDelivery: vi.fn(), getDelivery: vi.fn() }));

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

const IDS = {
  featurable: uuid(1),
  post: uuid(2),
  guide: uuid(3),
  blogPost: uuid(4),
  about: uuid(5),
  homepage: uuid(6),
  note: uuid(7),
  contractTitle: uuid(11),
  contractSummary: uuid(12),
  contractTone: uuid(13),
  postTitle: uuid(21),
  postSummary: uuid(22),
  postTone: uuid(23),
  steps: uuid(31),
  blogTitle: uuid(41),
  blogSummary: uuid(42),
  blogTone: uuid(43),
  blogSecret: uuid(44),
  aboutTitle: uuid(51),
  aboutSummary: uuid(52),
  aboutTone: uuid(53),
  featured: uuid(61),
  spotlight: uuid(62),
  noteText: uuid(71),
};

const define = (input: Record<string, unknown>): SchemaDefinition =>
  normalizeDefinition(input as Parameters<typeof normalizeDefinition>[0]);
const active = (definition: SchemaDefinition): ActiveDefinition => ({
  definition,
  version: 1,
  revisionId: uuid(900),
  hash: 'h',
  activatedAt: new Date(0),
  siteId: null,
});

const TONE = { values: [{ value: 'calm', label: 'Calm' }] };
/** The contract's three fields as a member declares them (its own IDs). */
const memberFields = (title: string, summary: string, tone: string) => [
  {
    id: title,
    apiKey: 'title',
    label: 'Title',
    type: 'string',
    required: true,
    filterable: true,
    sortable: true,
  },
  { id: summary, apiKey: 'summary', label: 'Summary', type: 'text' },
  { id: tone, apiKey: 'tone', label: 'Tone', type: 'enum', settings: TONE },
];

const featurable = define({
  id: IDS.featurable,
  kind: 'interface',
  apiKey: 'featurable',
  pluralApiKey: 'featurables',
  label: 'Featurable',
  fields: memberFields(IDS.contractTitle, IDS.contractSummary, IDS.contractTone),
  display: { titleFieldId: IDS.contractTitle },
});
const post = define({
  id: IDS.post,
  kind: 'collection',
  apiKey: 'post',
  label: 'Post',
  implements: [IDS.featurable],
  fields: memberFields(IDS.postTitle, IDS.postSummary, IDS.postTone),
});
const guide = define({
  id: IDS.guide,
  kind: 'collection',
  apiKey: 'guide',
  label: 'Guide',
  extends: IDS.post,
  fields: [{ id: IDS.steps, apiKey: 'steps', label: 'Steps', type: 'integer' }],
});
const blogPost = define({
  id: IDS.blogPost,
  kind: 'collection',
  apiKey: 'blogPost',
  label: 'Blog post',
  implements: [IDS.featurable],
  fields: [
    ...memberFields(IDS.blogTitle, IDS.blogSummary, IDS.blogTone),
    { id: IDS.blogSecret, apiKey: 'secret', label: 'Secret', type: 'string', public: false },
  ],
});
const about = define({
  id: IDS.about,
  kind: 'singleton',
  apiKey: 'about',
  label: 'About',
  implements: [IDS.featurable],
  fields: memberFields(IDS.aboutTitle, IDS.aboutSummary, IDS.aboutTone),
});
const homepage = define({
  id: IDS.homepage,
  kind: 'singleton',
  apiKey: 'homepage',
  label: 'Homepage',
  fields: [
    {
      id: IDS.featured,
      apiKey: 'featured',
      label: 'Featured',
      type: 'relation',
      settings: { target: IDS.featurable, cardinality: 'many' },
    },
    {
      id: IDS.spotlight,
      apiKey: 'spotlight',
      label: 'Spotlight',
      type: 'relation',
      settings: { target: ANY_TARGET, cardinality: 'one' },
    },
  ],
});
const note = define({
  id: IDS.note,
  kind: 'collection',
  apiKey: 'note',
  label: 'Note',
  fields: [{ id: IDS.noteText, apiKey: 'text', label: 'Text', type: 'string' }],
});

const snapshot = buildSnapshot(4, [featurable, post, guide, blogPost, about, homepage, note].map(active), [
  { code: 'en', label: 'English', isDefault: true, fallbacks: [] },
] as never);
const { schema } = buildGraphqlSchema(snapshot);

const typeOf = (target: GraphQLSchema, name: string) => target.getType(name);
const fieldNames = (target: GraphQLSchema, name: string): string[] => {
  const type = typeOf(target, name);
  return isObjectType(type) || isInterfaceType(type) || isInputObjectType(type)
    ? Object.keys(type.getFields())
    : [];
};
const interfacesOf = (target: GraphQLSchema, name: string): string[] => {
  const type = typeOf(target, name);
  return isObjectType(type) || isInterfaceType(type) ? type.getInterfaces().map(({ name: n }) => n) : [];
};
const implementations = (target: GraphQLSchema, name: string): string[] => {
  const type = typeOf(target, name);
  return isInterfaceType(type)
    ? target
        .getImplementations(type)
        .objects.map(({ name: n }) => n)
        .sort()
    : [];
};
const fieldType = (target: GraphQLSchema, typeName: string, field: string): string => {
  const type = typeOf(target, typeName);
  return isObjectType(type) || isInterfaceType(type) ? String(type.getFields()[field]?.type) : '';
};

const SYSTEM = ['id', 'locale', 'createdAt', 'updatedAt', 'publishedAt'];

describe('GraphQL interfaces from interface definitions', () => {
  it('builds a valid schema', () => {
    expect(() => assertValidSchema(schema)).not.toThrow();
  });

  it('gives the interface the system fields and its non-enum contract fields', () => {
    expect(isInterfaceType(typeOf(schema, 'Featurable'))).toBe(true);
    expect(fieldNames(schema, 'Featurable')).toEqual([...SYSTEM, 'localizations', 'title', 'summary']);
    expect(fieldType(schema, 'Featurable', 'localizations')).toBe('[Featurable!]');
    expect(interfacesOf(schema, 'Featurable')).toEqual(['Entry']);
    expect(implementations(schema, 'Featurable')).toEqual(['About', 'BlogPost', 'Guide', 'Post']);
  });

  it('lists every transitive interface on members, kinds and family interfaces', () => {
    expect(interfacesOf(schema, 'Post')).toEqual(['Entry', 'PostInterface', 'Featurable']);
    expect(interfacesOf(schema, 'Guide')).toEqual(['Entry', 'PostInterface', 'Featurable']);
    expect(interfacesOf(schema, 'PostInterface')).toEqual(['Entry', 'Featurable']);
    expect(interfacesOf(schema, 'About')).toEqual(['Entry', 'Featurable']);
    expect(interfacesOf(schema, 'Note')).toEqual(['Entry']);
  });

  it('has Entry with the system fields only, implemented by every entry type', () => {
    expect(fieldNames(schema, 'Entry')).toEqual(SYSTEM);
    expect(implementations(schema, 'Entry')).toEqual([
      'About',
      'BlogPost',
      'Guide',
      'Homepage',
      'Note',
      'Post',
    ]);
    expect(fieldNames(schema, 'EntryState')).toEqual(expect.arrayContaining(['version', 'status']));
  });

  it('adds the list and lookup queries with filters and sorts over the contract', () => {
    const query = schema.getQueryType()!.getFields();
    expect(String(query.featurable?.type)).toBe('Featurable');
    expect(query.featurable?.args.map((arg) => arg.name)).toContain('id');
    expect(String(query.featurables?.type)).toBe('FeaturableConnection');
    expect(fieldType(schema, 'FeaturableConnection', 'nodes')).toBe('[Featurable!]!');
    expect(fieldNames(schema, 'FeaturableFilter')).toEqual([
      'id',
      'createdAt',
      'updatedAt',
      'title',
      'summary',
      'and',
      'or',
      'not',
    ]);
    expect(fieldNames(schema, 'FeaturableSort')).toContain('title');
    expect(fieldNames(schema, 'FeaturableSort')).not.toContain('tone');
    expect(schema.getMutationType()?.getFields().createFeaturable).toBeUndefined();
  });

  it('types a relation to an interface as the interface and one to any entry as Entry', () => {
    expect(fieldType(schema, 'Homepage', 'featured')).toBe('[Featurable!]');
    expect(fieldType(schema, 'Homepage', 'spotlight')).toBe('Entry');
  });
});

const allow = (readIds: string[]): Policy => ({
  allowed: true,
  rowFilter: null,
  readMask: { mode: 'only', fieldIds: readIds, componentFields: 'public' },
  rowReadMasks: null,
  writeMask: { mode: 'only', fieldIds: [], componentFields: 'public' },
  rowWriteMasks: null,
});
const evaluatorOf = (policies: Record<string, Policy>): PermissionEvaluator => ({
  evaluate: (_principal: Principal, request: PolicyRequest) =>
    Promise.resolve(policies[`${request.action}:${request.modelId}`] ?? DENIED_POLICY),
  canPerform: () => Promise.resolve(false),
  canPerformOnSite: () => Promise.resolve(false),
});
const DELIVERY: Principal = { kind: 'token', tokenId: 't', scope: 'delivery', roleId: 'r', siteId: 's' };
const deliverySchema = async (policies: Record<string, Policy>) =>
  buildGraphqlSchema(snapshot, await resolveSchemaVisibility(snapshot, evaluatorOf(policies), DELIVERY))
    .schema;

describe('GraphQL interfaces under a delivery caller', () => {
  it('a member-only reader gets a valid schema with the interface over that member', async () => {
    const masked = await deliverySchema({
      [`read:${IDS.blogPost}`]: allow([IDS.blogTitle, IDS.blogSummary, IDS.blogTone]),
    });
    expect(() => assertValidSchema(masked)).not.toThrow();
    expect(fieldNames(masked, 'Featurable')).toEqual([...SYSTEM, 'localizations', 'title', 'summary']);
    expect(implementations(masked, 'Featurable')).toEqual(['BlogPost']);
    expect(masked.getQueryType()?.getFields().featurables).toBeDefined();
    expect(masked.getType('Post')).toBeUndefined();
  });

  it('keeps only the contract fields every readable member exposes', async () => {
    const masked = await deliverySchema({
      [`read:${IDS.blogPost}`]: allow([IDS.blogTitle, IDS.blogSummary]),
      [`read:${IDS.about}`]: allow([IDS.aboutSummary]),
    });
    expect(() => assertValidSchema(masked)).not.toThrow();
    expect(fieldNames(masked, 'Featurable')).toEqual([...SYSTEM, 'localizations', 'summary']);
    expect(fieldNames(masked, 'FeaturableFilter')).not.toContain('title');
    expect(fieldNames(masked, 'BlogPost')).toContain('title');
  });

  it('leaves the interface out when no member is readable; Entry stays', async () => {
    const masked = await deliverySchema({ [`read:${IDS.note}`]: allow([IDS.noteText]) });
    expect(() => assertValidSchema(masked)).not.toThrow();
    expect(masked.getType('Featurable')).toBeUndefined();
    expect(masked.getType('FeaturableConnection')).toBeUndefined();
    expect(masked.getQueryType()?.getFields().featurables).toBeUndefined();
    expect(implementations(masked, 'Entry')).toEqual(['Note']);
  });

  it('leaves out a relation to an interface none of whose members the caller reads', async () => {
    const masked = await deliverySchema({
      [`read:${IDS.homepage}`]: allow([IDS.featured, IDS.spotlight]),
    });
    expect(() => assertValidSchema(masked)).not.toThrow();
    expect(fieldNames(masked, 'Homepage')).toEqual([...SYSTEM, 'localizations', 'spotlight']);
  });
});

const listDelivery = vi.mocked(contentDeliveryService.listDelivery);
const getDelivery = vi.mocked(contentDeliveryService.getDelivery);

const row = (id: number, model: string | undefined, extra: Record<string, unknown> = {}) => ({
  id: uuid(id),
  locale: 'en',
  createdAt: 'c',
  updatedAt: 'u',
  publishedAt: 'p',
  ...(model ? { __model: model } : {}),
  title: `t${id}`,
  ...extra,
});
const page = (data: unknown[]) =>
  ({
    data,
    meta: { locale: 'en', snapshot: 1, pagination: { page: 1, pageSize: 25, pageCount: 1, total: 9 } },
  }) as never;

const contextOf = (entries: Record<string, Record<string, unknown>> = {}): GraphqlContext =>
  ({
    content: () => Promise.resolve({}),
    markDrafts: () => undefined,
    loaders: {
      entries: () => ({ load: (id: string) => Promise.resolve(entries[id] ?? null) }),
      localizations: () => ({ load: () => Promise.resolve([]) }),
    },
  }) as never;

const run = async (source: string, context = contextOf()) =>
  execute({ schema, document: parse(source), contextValue: context });

describe('resolving interface rows to their member', () => {
  beforeEach(() => {
    listDelivery.mockReset();
    getDelivery.mockReset();
  });

  it('reads the interface route and types each row by __model, leaving out non-members', async () => {
    listDelivery.mockResolvedValue(
      page([
        row(1, 'blogPost'),
        row(2, 'guide', { steps: 3 }),
        row(3, 'about'),
        row(4, 'note'),
        row(5, undefined),
      ]),
    );
    const result = await run(
      `{ featurables(sort: [{ title: ASC }], filter: { title: { containsi: "t" } }) {
          nodes { __typename id title ... on Guide { steps } } } }`,
    );
    expect(result.errors).toBeUndefined();
    expect(listDelivery.mock.calls[0]?.[1]).toBe('featurable');
    expect(decodeURIComponent(String(listDelivery.mock.calls[0]?.[2]))).toContain('sort[0]=title:asc');
    expect((result.data as { featurables: { nodes: unknown[] } }).featurables.nodes).toEqual([
      { __typename: 'BlogPost', id: uuid(1), title: 't1' },
      { __typename: 'Guide', id: uuid(2), title: 't2', steps: 3 },
      { __typename: 'About', id: uuid(3), title: 't3' },
    ]);
  });

  it('looks up one entry through the interface', async () => {
    getDelivery.mockResolvedValueOnce({ data: row(3, 'about') } as never);
    const result = await run(`{ featurable(id: "${uuid(3)}") { __typename title } }`);
    expect(result.errors).toBeUndefined();
    expect(getDelivery.mock.calls[0]?.[1]).toBe('featurable');
    expect(result.data).toEqual({ featurable: { __typename: 'About', title: 't3' } });
  });

  it('resolves relations to an interface and to any entry by __model', async () => {
    listDelivery.mockResolvedValueOnce({
      data: row(9, 'homepage', { featured: [uuid(1), uuid(4)], spotlight: uuid(4) }),
    } as never);
    const result = await run(
      `{ homepage {
          featured { __typename title }
          spotlight { __typename id ... on Note { text } } } }`,
      contextOf({ [uuid(1)]: row(1, 'blogPost'), [uuid(4)]: row(4, 'note', { text: 'hi' }) }),
    );
    expect(result.errors).toBeUndefined();
    expect(result.data).toEqual({
      homepage: {
        featured: [{ __typename: 'BlogPost', title: 't1' }],
        spotlight: { __typename: 'Note', id: uuid(4), text: 'hi' },
      },
    });
  });
});

describe('usage through interface definitions', () => {
  const usageOf = (source: string) => {
    const document = parse(source);
    const operation = document.definitions.find(
      (definition): definition is OperationDefinitionNode => definition.kind === Kind.OPERATION_DEFINITION,
    )!;
    const { reads } = operationUsage(schema, operation, fragmentsOf(document.definitions));
    return Object.fromEntries(
      [...reads].map(([modelId, paths]) => [modelId, paths.map(({ path }) => path).sort()]),
    );
  };

  it('counts an interface field against each member field and fragments against their type', () => {
    expect(usageOf('{ featurables { nodes { title ... on Guide { steps } } } }')).toEqual({
      [IDS.post]: [IDS.postTitle],
      [IDS.guide]: [IDS.postTitle, IDS.steps].sort(),
      [IDS.blogPost]: [IDS.blogTitle],
      [IDS.about]: [IDS.aboutTitle],
    });
  });

  it('counts reads inside interface and any-entry relations against the source model', () => {
    expect(usageOf('{ homepage { featured { summary } spotlight { id ... on Note { text } } } }')).toEqual({
      [IDS.homepage]: [
        IDS.featured,
        `${IDS.featured}.${IDS.aboutSummary}`,
        `${IDS.featured}.${IDS.blogSummary}`,
        `${IDS.featured}.${IDS.postSummary}`,
        IDS.spotlight,
        `${IDS.spotlight}.${IDS.noteText}`,
      ].sort(),
    });
  });
});
