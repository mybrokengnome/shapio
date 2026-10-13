import {
  isComponentDefinition,
  type ComponentDefinition,
  type FieldDefinition,
  type ResolvedModelDefinition,
  type SchemaDefinition,
} from '@shapio/schema';
import {
  GraphQLBoolean,
  GraphQLEnumType,
  GraphQLFloat,
  GraphQLID,
  GraphQLInterfaceType,
  GraphQLList,
  GraphQLNonNull,
  GraphQLObjectType,
  GraphQLString,
  GraphQLUnionType,
  type GraphQLFieldConfig,
  type GraphQLFieldConfigMap,
  type GraphQLOutputType,
} from 'graphql';
import { COMPONENT_KEY } from '../../../content/validator/index.js';
import { AppError } from '../../../helpers/appError.js';
import { memoType, type SchemaBuild } from './build.js';
import { RELATION_LIST_COST } from './complexity.js';
import { entryNode, type GraphqlContext, type ValueNode } from './context.js';
import { describeDefinition, describeField } from './descriptions.js';
import { declaringOwner, hasChildren, kindTypeName, resolvedModelById, servableNodes } from './entryKinds.js';
import { componentTypeName, fieldTypeName, modelTypeName } from './names.js';
import { modelReadable, readableFields } from './visibility.js';

/**
 * Object types for models (entries) and components, built from the snapshot and holding only the fields the
 * caller may see (visibility.ts): a delivery caller's schema never names a field outside its read mask, a
 * component's non-public field, or a model it cannot read. Values come from the delivery projection
 * (`content/compiler/select.ts`), which leaves out every field outside the caller's read mask for that row:
 * such a field resolves to null when optional and to a FORBIDDEN_FIELD error when required (ADR 0005), so a
 * client never mistakes a hidden value for an empty one.
 */
type FieldConfig = GraphQLFieldConfig<ValueNode, GraphqlContext>;

const list = (type: GraphQLOutputType) => new GraphQLList(new GraphQLNonNull(type));

export const maskedFieldError = (field: FieldDefinition) =>
  new AppError(403, 'FORBIDDEN_FIELD', `Your role may not read "${field.apiKey}"`, { field: field.apiKey });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** An enum field's type, keyed and named by the model that declares the field (shared down a family). */
export const enumType = (build: SchemaBuild, owner: SchemaDefinition, field: FieldDefinition<'enum'>) => {
  const declaring = declaringOwner(build, owner, field);
  return memoType(
    build.enums,
    `${declaring.id}:${field.id}`,
    () =>
      new GraphQLEnumType({
        name: fieldTypeName(declaring, field, 'Enum'),
        values: Object.fromEntries(
          field.settings.values.map((entry) => [
            entry.value,
            { value: entry.value, description: entry.label },
          ]),
        ),
      }),
  );
};

const componentById = (build: SchemaBuild, id: string): ComponentDefinition | undefined => {
  const definition = build.snapshot.byId.get(id)?.definition;
  return definition && isComponentDefinition(definition) ? definition : undefined;
};

const relationField = (build: SchemaBuild, field: FieldDefinition<'relation'>): FieldConfig | undefined => {
  const target = resolvedModelById(build.snapshot, field.settings.target);
  // A relation to a model the caller cannot read is left out: it could only ever resolve empty, and its type
  // would name the model (REST keeps the key, with null or []).
  if (!target || !modelReadable(build.visibility, target.id)) {
    return undefined;
  }
  // A target with children is its interface: the loader reads its whole family, each row as its own kind.
  const targetType = entryOutputType(build, target);
  const load = async (id: unknown, node: ValueNode, context: GraphqlContext) => {
    if (typeof id !== 'string') {
      return null;
    }
    const entry = await context.loaders.entries(build.snapshot, target.id, node.scope).load(id);
    const [loaded] = entry ? servableNodes(build, target, [entryNode(entry, node.scope)]) : [];
    return loaded ?? null;
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
  const type = component ? componentType(build, component) : null;
  if (!type) {
    return undefined;
  }
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

/** A zone's allowed components that have a type for this caller (some visible field), with their types. */
const zoneMembers = (build: SchemaBuild, field: FieldDefinition<'dynamiczone'>) =>
  field.settings.components.flatMap((id) => {
    const component = componentById(build, id);
    const type = component ? componentType(build, component) : null;
    return component && type ? [{ component, type }] : [];
  });

/** A zone's union, keyed and named by the model that declares the field (shared down a family). */
const zoneType = (build: SchemaBuild, owner: SchemaDefinition, field: FieldDefinition<'dynamiczone'>) => {
  const declaring = declaringOwner(build, owner, field);
  return memoType(build.zones, `${declaring.id}:${field.id}`, () => {
    const members = zoneMembers(build, field).map(({ type }) => type);
    return members.length === 0
      ? null
      : new GraphQLUnionType({
          name: fieldTypeName(declaring, field, 'Zone'),
          types: members,
          resolveType: (node: ValueNode) => {
            const component = build.snapshot.componentsByApiKey.get(String(node.data[COMPONENT_KEY]));
            return component ? componentTypeName(component.definition) : undefined;
          },
        });
  });
};

const zoneField = (
  build: SchemaBuild,
  owner: SchemaDefinition,
  field: FieldDefinition<'dynamiczone'>,
): FieldConfig | undefined => {
  const type = zoneType(build, owner, field);
  if (!type) {
    return undefined;
  }
  // Items of components no longer allowed in the zone (or deleted, or with no field this caller sees) have no
  // member type to resolve to.
  const allowed = new Set(zoneMembers(build, field).map(({ component }) => component.apiKey));
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
 * Fields of a model or component. When `masked`, a field missing from the projection is outside the caller's
 * read mask (the projection always emits every visible field, null when empty).
 */
const definitionFields = (build: SchemaBuild, owner: SchemaDefinition, masked: boolean) => {
  const fields: GraphQLFieldConfigMap<ValueNode, GraphqlContext> = {};
  for (const field of readableFields(build.visibility, owner)) {
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

/**
 * A component's type, or null when the caller sees none of its fields (GraphQL forbids empty object types).
 * Its fields are resolved eagerly to know that; components never nest cyclically (the registry validator
 * rejects cycles), and relation targets are thunked entry types, so this terminates.
 */
const componentType = (
  build: SchemaBuild,
  component: ComponentDefinition,
): GraphQLObjectType<ValueNode, GraphqlContext> | null =>
  memoType(build.components, component.id, () => {
    // Masked like entries: a delivery read leaves out a component's non-public fields (read mask).
    const fields = definitionFields(build, component, true);
    if (Object.keys(fields).length === 0) {
      return null;
    }
    const type = new GraphQLObjectType<ValueNode, GraphqlContext>({
      name: componentTypeName(component),
      description: describeDefinition(component),
      fields,
    });
    build.objects.set(component.id, type);
    return type;
  });

const SYSTEM_STRING = (name: 'locale' | 'createdAt' | 'updatedAt') => ({
  type: new GraphQLNonNull(GraphQLString),
  resolve: (node: ValueNode) => node.data[name],
});

const LOCALIZATIONS_DESCRIPTION = 'This entry in its other locales, read the same way (published or draft)';

/** The system fields every entry type and entry interface has, before `localizations` and the model's own. */
const systemFields = (): GraphQLFieldConfigMap<ValueNode, GraphqlContext> => ({
  id: { type: new GraphQLNonNull(GraphQLID), resolve: (node) => node.data.id },
  locale: {
    ...SYSTEM_STRING('locale'),
    description: 'The locale that served this entry (fallback aware)',
  },
  createdAt: SYSTEM_STRING('createdAt'),
  updatedAt: SYSTEM_STRING('updatedAt'),
  publishedAt: { type: GraphQLString, resolve: (node) => node.data.publishedAt ?? null },
});

const localizationsCost = (build: SchemaBuild) => ({
  cost: { list: Math.max(1, build.snapshot.locales.length - 1) },
});

/**
 * `<Type>Interface` of a model with children (plan polymorphic-types D9): the system fields and the model's
 * effective fields as the caller may read them on the model itself. Each readable descendant's read mask holds
 * at least those fields (a grant on a model applies to its descendants, D8, and inherited fields keep their ID
 * and `public` flag), so every implementing type has every interface field with the same type. It implements
 * the interfaces of its readable ancestors; `localizations` lists the interface and narrows to each kind's own
 * type on the object types. Rows resolve to their kind's type through `__model`.
 */
export const interfaceType = (build: SchemaBuild, model: ResolvedModelDefinition): GraphQLInterfaceType =>
  memoType(build.interfaces, model.id, () => {
    const type: GraphQLInterfaceType = new GraphQLInterfaceType({
      name: modelTypeName(model, 'Interface'),
      description: describeDefinition(model),
      interfaces: () => ancestorInterfaces(build, model),
      fields: () => ({
        ...systemFields(),
        localizations: {
          type: list(type),
          description: LOCALIZATIONS_DESCRIPTION,
          extensions: localizationsCost(build),
        },
        ...definitionFields(build, model, true),
      }),
      resolveType: (node: ValueNode) => kindTypeName(build, model, node),
    });
    return type;
  });

/** The interfaces of a model's readable ancestors, root first (an unreadable ancestor has none here). */
const ancestorInterfaces = (build: SchemaBuild, model: ResolvedModelDefinition): GraphQLInterfaceType[] =>
  model.ancestorIds.flatMap((id) => {
    const ancestor = modelReadable(build.visibility, id) ? resolvedModelById(build.snapshot, id) : undefined;
    return ancestor ? [interfaceType(build, ancestor)] : [];
  });

/** The interfaces a model's object type implements: its readable ancestors', then its own when it has children. */
const implementedInterfaces = (
  build: SchemaBuild,
  model: ResolvedModelDefinition,
): GraphQLInterfaceType[] => [
  ...ancestorInterfaces(build, model),
  ...(hasChildren(build, model.id) ? [interfaceType(build, model)] : []),
];

export const entryType = (
  build: SchemaBuild,
  model: ResolvedModelDefinition,
): GraphQLObjectType<ValueNode, GraphqlContext> =>
  memoType(build.objects, model.id, () => {
    const type: GraphQLObjectType<ValueNode, GraphqlContext> = new GraphQLObjectType<
      ValueNode,
      GraphqlContext
    >({
      name: modelTypeName(model),
      description: describeDefinition(model),
      interfaces: () => implementedInterfaces(build, model),
      fields: () => ({
        ...systemFields(),
        localizations: {
          type: list(type),
          description: LOCALIZATIONS_DESCRIPTION,
          extensions: localizationsCost(build),
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

/**
 * The output type of a model's entries wherever they are served (lookups, lists, relation targets): its
 * interface when it has children, so rows of every kind fit, else its object type, unchanged.
 */
export const entryOutputType = (
  build: SchemaBuild,
  model: ResolvedModelDefinition,
): GraphQLObjectType<ValueNode, GraphqlContext> | GraphQLInterfaceType =>
  hasChildren(build, model.id) ? interfaceType(build, model) : entryType(build, model);
