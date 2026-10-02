import { isModelDefinition, type ModelDefinition } from '@shapio/schema';
import {
  getArgumentValues,
  getNamedType,
  isInterfaceType,
  isObjectType,
  Kind,
  OperationTypeNode,
  type FieldNode,
  type FragmentDefinitionNode,
  type GraphQLSchema,
  type OperationDefinitionNode,
  type SelectionSetNode,
} from 'graphql';
import { liveFields } from '../../../content/model.js';
import type { FieldRead } from '../../../usage/aggregator.js';
import { relationFieldPath } from '../../../usage/keys.js';
import type { SchemaSnapshot } from '../../snapshot.js';
import { modelTypeName } from './names.js';

/**
 * Field usage for GraphQL (plan developer-face §5): which model fields one operation selects, found by
 * walking its selection set (fragments included) against the schema, once per operation and never in
 * resolvers or batch loaders. A field on an entry type is a read of that field (`explicit`: GraphQL always
 * names its fields); a field selected inside a relation's target counts one level deep as
 * `<relation field ID>.<target field ID>`. `localizations` reads the same model. Root fields read with
 * `publicationState: DRAFT` are previews and are skipped.
 *
 * Like the cost walk in complexity.ts, each fragment is expanded at most once per walk context, so
 * fragments spreading each other repeatedly cannot make the walk exponential.
 */
type EntryFieldInfo = { id: string; targetType?: string };
type EntryTypeInfo = { modelId: string; fields: ReadonlyMap<string, EntryFieldInfo> };

/** Entry type name → its model and its fields by API key (stored on the schema's `extensions`). */
export type GraphqlUsageMap = ReadonlyMap<string, EntryTypeInfo>;

export const USAGE_MAP_EXTENSION = 'shapioUsageMap';

export const buildUsageMap = (snapshot: SchemaSnapshot): GraphqlUsageMap => {
  const models = snapshot.definitions
    .map((active) => active.definition)
    .filter((definition): definition is ModelDefinition => isModelDefinition(definition));
  const typeOf = new Map(models.map((model) => [model.id, modelTypeName(model)]));
  return new Map(
    models.map((model) => [
      modelTypeName(model),
      {
        modelId: model.id,
        fields: new Map(
          liveFields(model.fields).map((field) => {
            const targetType = field.type === 'relation' ? typeOf.get(field.settings.target) : undefined;
            return [field.apiKey, { id: field.id, ...(targetType ? { targetType } : {}) }];
          }),
        ),
      },
    ]),
  );
};

export const usageMapOf = (schema: GraphQLSchema): GraphqlUsageMap | undefined =>
  (schema.extensions as Record<string, unknown> | undefined)?.[USAGE_MAP_EXTENSION] as
    GraphqlUsageMap | undefined;

export type OperationUsage = {
  /** Model ID → field reads. */
  reads: Map<string, FieldRead[]>;
  /** The `snapshot` argument a root read pinned, if any. */
  snapshot: number | null;
};

type Walk = {
  schema: GraphQLSchema;
  map: GraphqlUsageMap;
  fragments: ReadonlyMap<string, FragmentDefinitionNode>;
  variables: Readonly<Record<string, unknown>>;
  /** `<context>|<fragment>` pairs already expanded. */
  expanded: Set<string>;
  paths: Map<string, Set<string>>;
  snapshot: number | null;
};

/** The field nodes of a selection set, fragments flattened (each at most once per `context`). */
const fieldNodes = (walk: Walk, selectionSet: SelectionSetNode, context: string): FieldNode[] => {
  const nodes: FieldNode[] = [];
  for (const selection of selectionSet.selections) {
    if (selection.kind === Kind.FIELD) {
      nodes.push(selection);
    } else if (selection.kind === Kind.INLINE_FRAGMENT) {
      nodes.push(...fieldNodes(walk, selection.selectionSet, context));
    } else {
      const key = `${context}|${selection.name.value}`;
      const fragment = walk.fragments.get(selection.name.value);
      if (fragment && !walk.expanded.has(key)) {
        walk.expanded.add(key);
        nodes.push(...fieldNodes(walk, fragment.selectionSet, context));
      }
    }
  }
  return nodes;
};

const addPath = (walk: Walk, modelId: string, path: string) => {
  const paths = walk.paths.get(modelId) ?? new Set<string>();
  paths.add(path);
  walk.paths.set(modelId, paths);
};

const walkTarget = (
  walk: Walk,
  typeName: string,
  selectionSet: SelectionSetNode,
  modelId: string,
  relationId: string,
) => {
  const info = walk.map.get(typeName);
  if (!info) {
    return;
  }
  for (const node of fieldNodes(walk, selectionSet, `target:${modelId}:${relationId}`)) {
    const field = info.fields.get(node.name.value);
    if (field) {
      addPath(walk, modelId, relationFieldPath(relationId, field.id));
    }
  }
};

const walkEntry = (walk: Walk, typeName: string, selectionSet: SelectionSetNode) => {
  const info = walk.map.get(typeName);
  if (!info) {
    return;
  }
  for (const node of fieldNodes(walk, selectionSet, `entry:${typeName}`)) {
    if (node.name.value === 'localizations' && node.selectionSet) {
      walkEntry(walk, typeName, node.selectionSet);
      continue;
    }
    const field = info.fields.get(node.name.value);
    if (!field) {
      continue;
    }
    addPath(walk, info.modelId, field.id);
    if (field.targetType && node.selectionSet) {
      walkTarget(walk, field.targetType, node.selectionSet, info.modelId, field.id);
    }
  }
};

type RootArgs = { publicationState?: unknown; snapshot?: unknown };

const rootArgs = (walk: Walk, parentType: string, node: FieldNode): RootArgs => {
  const parent = walk.schema.getType(parentType);
  const definition = isObjectType(parent) ? parent.getFields()[node.name.value] : undefined;
  if (!definition) {
    return {};
  }
  try {
    return getArgumentValues(definition, node, walk.variables);
  } catch {
    // Invalid arguments fail the operation in execution; they read nothing.
    return { publicationState: 'draft' };
  }
};

/** Walks object types above entries (Query, connections) until it reaches entry types. */
const walkObjects = (walk: Walk, typeName: string, selectionSet: SelectionSetNode, root: boolean) => {
  const parent = walk.schema.getType(typeName);
  if (!parent || !(isObjectType(parent) || isInterfaceType(parent))) {
    return;
  }
  for (const node of fieldNodes(walk, selectionSet, `objects:${typeName}`)) {
    const definition = parent.getFields()[node.name.value];
    if (!definition || node.name.value.startsWith('__') || !node.selectionSet) {
      continue;
    }
    if (root) {
      const args = rootArgs(walk, typeName, node);
      const state = args.publicationState;
      if (typeof state === 'string' && state.toLowerCase() === 'draft') {
        continue;
      }
      if (typeof args.snapshot === 'number' && walk.snapshot === null) {
        walk.snapshot = args.snapshot;
      }
    }
    const child = getNamedType(definition.type).name;
    if (walk.map.has(child)) {
      walkEntry(walk, child, node.selectionSet);
    } else {
      walkObjects(walk, child, node.selectionSet, false);
    }
  }
};

/** The model fields a query operation reads; mutations and subscriptions read nothing here. */
export const operationUsage = (
  schema: GraphQLSchema,
  operation: OperationDefinitionNode,
  fragments: ReadonlyMap<string, FragmentDefinitionNode>,
  variables: Readonly<Record<string, unknown>> = {},
): OperationUsage => {
  const map = usageMapOf(schema);
  const queryType = schema.getQueryType();
  const walk: Walk = {
    schema,
    map: map ?? new Map(),
    fragments,
    variables,
    expanded: new Set(),
    paths: new Map(),
    snapshot: null,
  };
  if (map && queryType && operation.operation === OperationTypeNode.QUERY) {
    walkObjects(walk, queryType.name, operation.selectionSet, true);
  }
  const reads = new Map<string, FieldRead[]>();
  for (const [modelId, paths] of walk.paths) {
    reads.set(
      modelId,
      [...paths].map((path) => ({ path, selection: 'explicit' as const })),
    );
  }
  return { reads, snapshot: walk.snapshot };
};
