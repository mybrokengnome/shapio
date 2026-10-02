import {
  GraphQLBoolean,
  GraphQLEnumType,
  GraphQLFloat,
  GraphQLID,
  GraphQLInputObjectType,
  GraphQLInt,
  GraphQLList,
  GraphQLNonNull,
  GraphQLObjectType,
  GraphQLScalarType,
  GraphQLString,
  GraphQLError,
  Kind,
  valueFromASTUntyped,
  type GraphQLInputFieldConfigMap,
  type GraphQLInputType,
} from 'graphql';
import { OPERATORS_BY_FAMILY } from '../../../content/compiler/operators.js';
import type { FilterOperator } from '../../../content/compiler/types.js';

/**
 * The types every Shapio GraphQL schema has. All of their names are in `RESERVED_TYPE_NAMES`
 * (`@shapio/schema` naming.ts), so no model can collide with them.
 */
const nonNull = <T extends GraphQLInputType>(type: T) => new GraphQLNonNull(type);

export const createJsonScalar = () =>
  new GraphQLScalarType({
    name: 'JSON',
    description: 'Any JSON value (JSON fields and rich-text documents).',
    serialize: (value) => value,
    parseValue: (value) => value,
    parseLiteral: (ast, variables) => valueFromASTUntyped(ast, variables),
  });

const toInt53 = (value: unknown): number => {
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof number !== 'number' || !Number.isSafeInteger(number)) {
    throw new GraphQLError(`Int53 cannot represent ${JSON.stringify(value)}: it needs a safe integer`);
  }
  return number;
};

/**
 * `integer` fields: whole numbers in JavaScript's safe-integer range (±2^53 − 1), the range Shapio stores,
 * serialized as JSON numbers. GraphQL's own `Int` is 32-bit and would reject valid stored values.
 */
export const createInt53Scalar = () =>
  new GraphQLScalarType<number, number>({
    name: 'Int53',
    description: 'An integer between -(2^53 - 1) and 2^53 - 1, as a JSON number.',
    serialize: toInt53,
    parseValue: (value) => {
      if (typeof value !== 'number') {
        throw new GraphQLError(`Int53 needs a number, got ${JSON.stringify(value)}`);
      }
      return toInt53(value);
    },
    parseLiteral: (ast) => {
      if (ast.kind !== Kind.INT) {
        throw new GraphQLError('Int53 needs an integer literal', { nodes: [ast] });
      }
      return toInt53(Number(ast.value));
    },
  });

/** Filter operator → GraphQL input field name (`$containsi` → `containsi`). */
export const operatorFieldName = (operator: FilterOperator) => operator.slice(1);

const OPERATOR_DESCRIPTIONS: Readonly<Record<FilterOperator, string>> = {
  $eq: 'Equals (on list fields: contains)',
  $ne: 'Does not equal',
  $in: 'Equals one of',
  $nin: 'Equals none of',
  $lt: 'Less than (needs filterable or sortable)',
  $lte: 'Less than or equal (needs filterable or sortable)',
  $gt: 'Greater than (needs filterable or sortable)',
  $gte: 'Greater than or equal (needs filterable or sortable)',
  $contains: 'Contains, case-sensitive (needs filterable)',
  $notContains: 'Does not contain, case-sensitive (needs filterable)',
  $containsi: 'Contains, case-insensitive (needs filterable)',
  $startsWith: 'Starts with (needs filterable)',
  $endsWith: 'Ends with (needs filterable)',
  $null: 'true: has no value; false: has a value',
  $notNull: 'true: has a value; false: has no value',
};

const filterType = (
  name: string,
  value: GraphQLInputType,
  operators: readonly FilterOperator[],
): GraphQLInputObjectType =>
  new GraphQLInputObjectType({
    name,
    description: `Conditions on one ${name.replace(/Filter$/, '')} value, ANDed. The same operators as the REST API's filters.`,
    fields: () => {
      const fields: GraphQLInputFieldConfigMap = {};
      for (const operator of operators) {
        const type =
          operator === '$null' || operator === '$notNull'
            ? GraphQLBoolean
            : operator === '$in' || operator === '$nin'
              ? new GraphQLList(nonNull(value))
              : value;
        fields[operatorFieldName(operator)] = { type, description: OPERATOR_DESCRIPTIONS[operator] };
      }
      return fields;
    },
  });

export type FilterTypeName =
  | 'StringFilter'
  | 'IntFilter'
  | 'FloatFilter'
  | 'BooleanFilter'
  | 'IDFilter'
  | 'DateFilter'
  | 'DateTimeFilter'
  | 'TimeFilter'
  | 'DecimalFilter'
  | 'BigIntFilter';

const createFilterTypes = (int53: GraphQLScalarType): Record<FilterTypeName, GraphQLInputObjectType> => ({
  StringFilter: filterType('StringFilter', GraphQLString, OPERATORS_BY_FAMILY.text),
  IntFilter: filterType('IntFilter', int53, OPERATORS_BY_FAMILY.number),
  FloatFilter: filterType('FloatFilter', GraphQLFloat, OPERATORS_BY_FAMILY.number),
  BooleanFilter: filterType('BooleanFilter', GraphQLBoolean, OPERATORS_BY_FAMILY.boolean),
  IDFilter: filterType('IDFilter', GraphQLID, OPERATORS_BY_FAMILY.reference),
  DateFilter: filterType('DateFilter', GraphQLString, OPERATORS_BY_FAMILY.temporal),
  DateTimeFilter: filterType('DateTimeFilter', GraphQLString, OPERATORS_BY_FAMILY.temporal),
  TimeFilter: filterType('TimeFilter', GraphQLString, OPERATORS_BY_FAMILY.temporal),
  DecimalFilter: filterType('DecimalFilter', GraphQLString, OPERATORS_BY_FAMILY.numericString),
  BigIntFilter: filterType('BigIntFilter', GraphQLString, OPERATORS_BY_FAMILY.numericString),
});

type Pagination = { page: number; pageSize: number; total: number; pageCount: number };

const createPageInfo = () =>
  new GraphQLObjectType<Pagination>({
    name: 'PageInfo',
    fields: {
      page: { type: nonNull(GraphQLInt) },
      pageSize: { type: nonNull(GraphQLInt) },
      pageCount: { type: nonNull(GraphQLInt) },
      hasNextPage: { type: nonNull(GraphQLBoolean), resolve: (info) => info.page < info.pageCount },
      hasPreviousPage: { type: nonNull(GraphQLBoolean), resolve: (info) => info.page > 1 },
    },
  });

type RichTextValue = { html?: unknown } & Record<string, unknown>;

const createRichText = (json: GraphQLScalarType) =>
  new GraphQLObjectType<RichTextValue>({
    name: 'RichText',
    description: 'A rich-text document: the versioned JSON document and its sanitized HTML rendering.',
    fields: {
      json: {
        type: nonNull(json),
        description: '`{ format, version, doc }` (ProseMirror JSON)',
        resolve: ({ html: _html, ...document }) => document,
      },
      html: { type: nonNull(GraphQLString), resolve: (value) => value.html ?? '' },
    },
  });

const createFocalPoint = () =>
  new GraphQLObjectType({
    name: 'FocalPoint',
    description: 'Where the subject of an image is, as fractions of its width and height (0 to 1).',
    fields: { x: { type: nonNull(GraphQLFloat) }, y: { type: nonNull(GraphQLFloat) } },
  });

const createMediaVariant = () =>
  new GraphQLObjectType({
    name: 'MediaVariant',
    description: 'A ready image variant (thumbnail, responsive width, converted format).',
    fields: {
      name: { type: nonNull(GraphQLString) },
      width: { type: GraphQLInt },
      height: { type: GraphQLInt },
      format: { type: GraphQLString },
      mimeType: { type: nonNull(GraphQLString) },
      url: { type: nonNull(GraphQLString) },
    },
  });

const createMedia = (focalPoint: GraphQLObjectType, variant: GraphQLObjectType) =>
  new GraphQLObjectType({
    name: 'Media',
    description: 'A media asset. Private assets carry signed URLs that expire at `urlExpiresAt`.',
    fields: {
      id: { type: nonNull(GraphQLID) },
      filename: { type: nonNull(GraphQLString) },
      mimeType: { type: nonNull(GraphQLString) },
      sizeBytes: { type: nonNull(GraphQLFloat) },
      width: { type: GraphQLInt },
      height: { type: GraphQLInt },
      alt: { type: nonNull(GraphQLString) },
      caption: { type: nonNull(GraphQLString) },
      focalPoint: { type: focalPoint },
      url: { type: nonNull(GraphQLString) },
      urlExpiresAt: { type: GraphQLString },
      variants: { type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(variant))) },
    },
  });

/** What a mutation returns: identity and state only, never values (writes create drafts). */
const createEntry = () =>
  new GraphQLObjectType({
    name: 'Entry',
    fields: {
      id: { type: nonNull(GraphQLID) },
      locale: { type: nonNull(GraphQLString) },
      version: { type: nonNull(GraphQLInt) },
      status: { type: nonNull(GraphQLString), description: 'draft, published or modified' },
      createdAt: { type: nonNull(GraphQLString) },
      updatedAt: { type: nonNull(GraphQLString) },
      publishedAt: { type: GraphQLString },
    },
  });

export const createFixedTypes = () => {
  const json = createJsonScalar();
  const int53 = createInt53Scalar();
  return {
    json,
    int53,
    filters: createFilterTypes(int53),
    pageInfo: createPageInfo(),
    richText: createRichText(json),
    media: createMedia(createFocalPoint(), createMediaVariant()),
    entry: createEntry(),
    publicationState: new GraphQLEnumType({
      name: 'PublicationState',
      description: 'DRAFT is for admin principals only (previews).',
      values: { PUBLISHED: { value: 'published' }, DRAFT: { value: 'draft' } },
    }),
    sortDirection: new GraphQLEnumType({
      name: 'SortDirection',
      values: { ASC: { value: 'asc' }, DESC: { value: 'desc' } },
    }),
  };
};

export type FixedTypes = ReturnType<typeof createFixedTypes>;
