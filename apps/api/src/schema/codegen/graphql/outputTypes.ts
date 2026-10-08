import {
  isComponentDefinition,
  isModelDefinition,
  type ComponentDefinition,
  type FieldDefinition,
  type ModelDefinition,
  type SchemaDefinition,
} from '@shapio/schema';
import {
  GraphQLBoolean,
  GraphQLEnumType,
  GraphQLFloat,
  GraphQLID,
  GraphQLList,
  GraphQLNonNull,
  GraphQLObjectType,
  GraphQLString,
  GraphQLUnionType,
  type GraphQLFieldConfig,
  type GraphQLFieldConfigMap,
  type GraphQLOutputType,
} from 'graphql';
import { liveFields } from '../../../content/model.js';
import { COMPONENT_KEY } from '../../../content/validator/index.js';
import { AppError } from '../../../helpers/appError.js';
import { memoType, type SchemaBuild } from './build.js';
import { RELATION_LIST_COST } from './complexity.js';
import { entryNode, type GraphqlContext, type ValueNode } from './context.js';
import { describeDefinition, describeField } from './descriptions.js';
import { componentTypeName, fieldTypeName, modelTypeName } from './names.js';

/**
 * Object types for models (entries) and components, built from the snapshot. Values come from the delivery
 * projection (`content/compiler/select.ts`), which leaves out every field outside the caller's read mask:
 * such a field resolves to null when optional and to a FORBIDDEN_FIELD error when required (ADR 0005), so
 * a client never mistakes a hidden value for an empty one.
 */
type FieldConfig = GraphQLFieldConfig<ValueNode, GraphqlContext>;

const list = (type: GraphQLOutputType) => new GraphQLList(new GraphQLNonNull(type));

export const maskedFieldError = (field: FieldDefinition) =>
  new AppError(403, 'FORBIDDEN_FIELD', `Your role may not read "${field.apiKey}"`, { field: field.apiKey });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const enumType = (build: SchemaBuild, owner: SchemaDefinition, field: FieldDefinition<'enum'>) =>
  memoType(
    build.enums,
    `${owner.id}:${field.id}`,
    () =>
      new GraphQLEnumType({
        name: fieldTypeName(owner, field, 'Enum'),
        values: Object.fromEntries(
          field.settings.values.map((entry) => [
            entry.value,
            { value: entry.value, description: entry.label },
          ]),
        ),
      }),
  );

const modelById = (build: SchemaBuild, id: string): ModelDefinition | undefined => {
  const definition = build.snapshot.byId.get(id)?.definition;
  return definition && isModelDefinition(definition) ? definition : undefined;
};

const componentById = (build: SchemaBuild, id: string): ComponentDefinition | undefined => {
  const definition = build.snapshot.byId.get(id)?.definition;
  return definition && isComponentDefinition(definition) ? definition : undefined;
};

const relationField = (build: SchemaBuild, field: FieldDefinition<'relation'>): FieldConfig | undefined => {
  const target = modelById(build, field.settings.target);
  if (!target) {
    return undefined;
  }
  const targetType = entryType(build, target);
  const load = async (id: unknown, node: ValueNode, context: GraphqlContext) => {
    if (typeof id !== 'string') {
      return null;
    }
    const entry = await context.loaders.entries(build.snapshot, target.id, node.scope).load(id);
    return entry ? entryNode(entry, node.scope) : null;
  };
  if (field.settings.cardinality === 'many') {
    return {
      type: list(targetType),
      extensions: { cost: { list: RELATION_LIST_COST } },
      resolve: async (node, _args, context) => {
        const ids = node.data[field.apiKey];
        const loaded = await Promise.all(
          (Array.isArray(ids) ? ids : []).map((id) => load(id, node, context)),
        );
        return loaded.filter((entry) => entry !== null);
      },
    };
  }
  return {
    type: targetType,
    resolve: (node, _args, context) => load(node.data[field.apiKey], node, context),
  };
};

const componentField = (build: SchemaBuild, field: FieldDefinition<'component'>): FieldConfig | undefined => {
  const component = componentById(build, field.settings.component);
  if (!component || liveFields(component.fields).length === 0) {
    return undefined;
  }
  const type = componentType(build, component);
  const toNode = (value: unknown, node: ValueNode) =>
    isRecord(value) ? { data: value, scope: node.scope } : null;
  if (field.settings.repeatable) {
    return {
      type: list(type),
      resolve: (node) => {
        const values = node.data[field.apiKey];
        return (Array.isArray(values) ? values : []).flatMap((value) => toNode(value, node) ?? []);
      },
    };
  }
  return { type, resolve: (node) => toNode(node.data[field.apiKey], node) };
};

const zoneType = (build: SchemaBuild, owner: SchemaDefinition, field: FieldDefinition<'dynamiczone'>) =>
  memoType(build.zones, `${owner.id}:${field.id}`, () => {
    const members = field.settings.components
      .map((id) => componentById(build, id))
      .filter((component) => component !== undefined && liveFields(component.fields).length > 0)
      .map((component) => componentType(build, component as ComponentDefinition));
    return members.length === 0
      ? null
      : new GraphQLUnionType({
          name: fieldTypeName(owner, field, 'Zone'),
          types: members,
          resolveType: (node: ValueNode) => {
            const component = build.snapshot.componentsByApiKey.get(String(node.data[COMPONENT_KEY]));
            return component ? componentTypeName(component.definition) : undefined;
          },
        });
  });

const zoneField = (
  build: SchemaBuild,
  owner: SchemaDefinition,
  field: FieldDefinition<'dynamiczone'>,
): FieldConfig | undefined => {
  const type = zoneType(build, owner, field);
  if (!type) {
    return undefined;
  }
  // Items of components no longer allowed in the zone (or deleted) have no member type to resolve to.
  const allowed = new Set(
    field.settings.components.flatMap((id) => {
      const component = componentById(build, id);
      return component ? [component.apiKey] : [];
    }),
  );
  return {
    type: list(type),
    resolve: (node) => {
      const values = node.data[field.apiKey];
      return (Array.isArray(values) ? values : []).flatMap((value) =>
        isRecord(value) && allowed.has(String(value[COMPONENT_KEY]))
          ? [{ data: value, scope: node.scope }]
          : [],
      );
    },
  };
};

const scalarType = (
  build: SchemaBuild,
  owner: SchemaDefinition,
  field: FieldDefinition,
): GraphQLOutputType => {
  switch (field.type) {
    case 'number':
      return GraphQLFloat;
    case 'integer':
      return build.fixed.int53;
    case 'boolean':
      return GraphQLBoolean;
    case 'json':
      return build.fixed.json;
    case 'richtext':
      return build.fixed.richText;
    case 'media':
      return field.settings.multiple ? list(build.fixed.media) : build.fixed.media;
    case 'enum': {
      const type = enumType(build, owner, field);
      return field.settings.multiple ? list(type) : type;
    }
    default:
      // string, text, slug, email, url, uid, date, datetime, time, decimal, biginteger
      return GraphQLString;
  }
};

/** The value config of one field, before masking is applied (undefined: the field cannot be exposed). */
const valueField = (
  build: SchemaBuild,
  owner: SchemaDefinition,
  field: FieldDefinition,
): FieldConfig | undefined => {
  switch (field.type) {
    case 'relation':
      return relationField(build, field);
    case 'component':
      return componentField(build, field);
    case 'dynamiczone':
      return zoneField(build, owner, field);
    default:
      return { type: scalarType(build, owner, field), resolve: (node) => node.data[field.apiKey] ?? null };
  }
};

/**
 * Fields of a model or component. On entries (`masked`), a field missing from the projection is outside the
 * caller's read mask.
 */
const definitionFields = (build: SchemaBuild, owner: SchemaDefinition, masked: boolean) => {
  const fields: GraphQLFieldConfigMap<ValueNode, GraphqlContext> = {};
  for (const field of liveFields(owner.fields)) {
    const config = valueField(build, owner, field);
    if (!config) {
      continue;
    }
    const resolve = config.resolve;
    fields[field.apiKey] = {
      ...config,
      description: describeField(field),
      resolve: (node, args, context, info) => {
        if (masked && !Object.hasOwn(node.data, field.apiKey)) {
          if (field.required) {
            throw maskedFieldError(field);
          }
          return null;
        }
        return resolve ? resolve(node, args, context, info) : null;
      },
    };
  }
  return fields;
};

export const componentType = (build: SchemaBuild, component: ComponentDefinition) =>
  memoType(
    build.objects,
    component.id,
    () =>
      new GraphQLObjectType<ValueNode, GraphqlContext>({
        name: componentTypeName(component),
        description: describeDefinition(component),
        fields: () => definitionFields(build, component, false),
      }),
  );

const SYSTEM_STRING = (name: 'locale' | 'createdAt' | 'updatedAt') => ({
  type: new GraphQLNonNull(GraphQLString),
  resolve: (node: ValueNode) => node.data[name],
});

export const entryType = (
  build: SchemaBuild,
  model: ModelDefinition,
): GraphQLObjectType<ValueNode, GraphqlContext> =>
  memoType(build.objects, model.id, () => {
    const type: GraphQLObjectType<ValueNode, GraphqlContext> = new GraphQLObjectType<
      ValueNode,
      GraphqlContext
    >({
      name: modelTypeName(model),
      description: describeDefinition(model),
      fields: () => ({
        id: { type: new GraphQLNonNull(GraphQLID), resolve: (node) => node.data.id },
        locale: {
          ...SYSTEM_STRING('locale'),
          description: 'The locale that served this entry (fallback aware)',
        },
        createdAt: SYSTEM_STRING('createdAt'),
        updatedAt: SYSTEM_STRING('updatedAt'),
        publishedAt: { type: GraphQLString, resolve: (node) => node.data.publishedAt ?? null },
        localizations: {
          type: list(type),
          description: 'This entry in its other locales, read the same way (published or draft)',
          extensions: { cost: { list: Math.max(1, build.snapshot.locales.length - 1) } },
          resolve: async (node, _args, context) => {
            const versions = await context.loaders
              .localizations(build.snapshot, model.id, node.scope)
              .load(String(node.data.id));
            return versions
              .filter((version) => version.locale !== node.data.locale)
              .map((version) =>
                entryNode(version, { ...node.scope, locale: String(version.locale), fallback: false }),
              );
          },
        },
        ...definitionFields(build, model, true),
      }),
    });
    return type;
  });
