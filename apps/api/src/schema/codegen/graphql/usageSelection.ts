import { isInterfaceDefinition, type FieldDefinition, type ResolvedModelDefinition } from '@shapio/schema';
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
import { relationTargetOf } from '../../../content/relationTarget.js';
import type { FieldRead } from '../../../usage/aggregator.js';
import { relationFieldPath } from '../../../usage/keys.js';
import type { SchemaSnapshot } from '../../snapshot.js';
import { resolvedModelById } from './entryKinds.js';
import { ENTRY_TYPE_NAME } from './interfaceTypes.js';
import { modelTypeName } from './names.js';
import { FULL_VISIBILITY, modelReadable, type SchemaVisibility } from './visibility.js';

/**
 * Field usage for GraphQL (plan developer-face §5): which model fields one operation selects, found by
 * walking its selection set (fragments included) against the schema, once per operation and never in
 * resolvers or batch loaders. A field on an entry type is a read of that field (`explicit`: GraphQL always
 * names its fields); a field selected inside a relation's target counts one level deep as
 * `<relation field ID>.<target field ID>`. `localizations` reads the same model. Root fields read with
 * `publicationState: DRAFT` are previews and are skipped.
 *
 * Model inheritance (plan polymorphic-types D9): `<Type>Interface` maps to the model that declares it, so a
 * field read through a parent's list counts against the parent; a fragment whose type condition is an entry
 * type or interface (`... on DigitalProduct`) counts against that type's model. A field read through an
 * interface definition (plan interfaces D8) counts against every member in the caller's schema, each on its
 * own field; `Entry` counts nothing.
 *
 * Like the cost walk in complexity.ts, each fragment is expanded at most once per walk context, so
 * fragments spreading each other repeatedly cannot make the walk exponential.
 */
/** A read of one stored field: the model it is counted against and its field ID there. */
type FieldTarget = { modelId: string; fieldId: string };
/**
 * A field of an entry type or interface: the stored fields a read of it counts against (one for a model's
 * type; one per member in the caller's schema for an interface definition), and its relation target's type.
 */
type EntryFieldInfo = { reads: readonly FieldTarget[]; targetType?: string };
type EntryTypeInfo = { fields: ReadonlyMap<string, EntryFieldInfo> };

/** Entry type name → its fields by API key (stored on the schema's `extensions`). */
export type GraphqlUsageMap = ReadonlyMap<string, EntryTypeInfo>;

export const USAGE_MAP_EXTENSION = 'shapioUsageMap';

/** The type name relations to a target are typed as: a model's (its interface when it has children), an interface definition's, `Entry`. */
const targetTypeName = (snapshot: SchemaSnapshot, field: FieldDefinition<'relation'>): string | undefined => {
  const target = relationTargetOf(snapshot, field);
  if (target.kind === 'any') {
    return ENTRY_TYPE_NAME;
  }
  const definition = snapshot.byId.get(target.id)?.definition;
  if (!definition) {
    return undefined;
  }
  return modelTypeName(
    definition,
    target.kind === 'model' && snapshot.childrenOf(target.id).length > 0 ? 'Interface' : '',
  );
};

const fieldInfo = (
  snapshot: SchemaSnapshot,
  field: FieldDefinition,
  reads: readonly FieldTarget[],
): EntryFieldInfo => {
  const targetType = field.type === 'relation' ? targetTypeName(snapshot, field) : undefined;
  return { reads, ...(targetType ? { targetType } : {}) };
};

/**
 * Model types map their fields to themselves. An interface definition's type (plan interfaces D8) maps each
 * contract field to the matching field of every member in the caller's schema (`memberFieldOf`), so a read
 * through `Featurable` counts against each member's own field. `Entry` has system fields only and counts
 * nothing; it is mapped so fragments inside it are recognized.
 */
export const buildUsageMap = (
  snapshot: SchemaSnapshot,
  visibility: SchemaVisibility = FULL_VISIBILITY,
): GraphqlUsageMap => {
  const models = snapshot.definitions
    .map((active) => resolvedModelById(snapshot, active.definition.id))
    .filter((model): model is ResolvedModelDefinition => model !== undefined);
  const map = new Map<string, EntryTypeInfo>();
  for (const model of models) {
    const info: EntryTypeInfo = {
      fields: new Map(
        liveFields(model.fields).map((field) => [
          field.apiKey,
          fieldInfo(snapshot, field, [{ modelId: model.id, fieldId: field.id }]),
        ]),
      ),
    };
    map.set(modelTypeName(model), info);
    if (snapshot.childrenOf(model.id).length > 0) {
      map.set(modelTypeName(model, 'Interface'), info);
    }
  }
  for (const { definition } of snapshot.definitions) {
    if (!isInterfaceDefinition(definition)) {
      continue;
    }
    const members = snapshot.implementedBy(definition.id).filter((id) => modelReadable(visibility, id));
    const fields = liveFields(definition.fields).map((field): [string, EntryFieldInfo] => [
      field.apiKey,
      fieldInfo(
        snapshot,
        field,
        members.flatMap((modelId) => {
          const memberField = snapshot.memberFieldOf(definition.id, field.id, modelId);
          return memberField ? [{ modelId, fieldId: memberField.id }] : [];
        }),
      ),
    ]);
    map.set(modelTypeName(definition), { fields: new Map(fields) });
  }
  map.set(ENTRY_TYPE_NAME, { fields: new Map() });
  return map;
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

/** A selected field and the entry type it is read on (a fragment's type condition, else the enclosing type). */
type SelectedField = { node: FieldNode; typeName: string };

/** The type a fragment's fields are read on: its type condition when that is an entry type or interface. */
const conditionType = (walk: Walk, condition: string | undefined, typeName: string) =>
  condition !== undefined && walk.map.has(condition) ? condition : typeName;

/**
 * The field nodes of a selection set read on `typeName`, fragments flattened (each at most once per
 * `context`), each with the type it is read on (inline fragments and spreads keep their type condition).
 */
const fieldNodes = (
  walk: Walk,
  selectionSet: SelectionSetNode,
  context: string,
  typeName: string,
): SelectedField[] => {
  const nodes: SelectedField[] = [];
  for (const selection of selectionSet.selections) {
    if (selection.kind === Kind.FIELD) {
      nodes.push({ node: selection, typeName });
    } else if (selection.kind === Kind.INLINE_FRAGMENT) {
      const type = conditionType(walk, selection.typeCondition?.name.value, typeName);
      nodes.push(...fieldNodes(walk, selection.selectionSet, context, type));
    } else {
      const key = `${context}|${selection.name.value}`;
      const fragment = walk.fragments.get(selection.name.value);
      if (fragment && !walk.expanded.has(key)) {
        walk.expanded.add(key);
        const type = conditionType(walk, fragment.typeCondition.name.value, typeName);
        nodes.push(...fieldNodes(walk, fragment.selectionSet, context, type));
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
  for (const { node, typeName: readOn } of fieldNodes(
    walk,
    selectionSet,
    `target:${modelId}:${relationId}`,
    typeName,
  )) {
    for (const read of walk.map.get(readOn)?.fields.get(node.name.value)?.reads ?? []) {
      addPath(walk, modelId, relationFieldPath(relationId, read.fieldId));
    }
  }
};

const walkEntry = (walk: Walk, typeName: string, selectionSet: SelectionSetNode) => {
  for (const { node, typeName: readOn } of fieldNodes(walk, selectionSet, `entry:${typeName}`, typeName)) {
    const info = walk.map.get(readOn);
    if (!info) {
      continue;
    }
    if (node.name.value === 'localizations' && node.selectionSet) {
      walkEntry(walk, readOn, node.selectionSet);
      continue;
    }
    const field = info.fields.get(node.name.value);
    if (!field) {
      continue;
    }
    for (const read of field.reads) {
      addPath(walk, read.modelId, read.fieldId);
      if (field.targetType && node.selectionSet) {
        walkTarget(walk, field.targetType, node.selectionSet, read.modelId, read.fieldId);
      }
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
  for (const { node } of fieldNodes(walk, selectionSet, `objects:${typeName}`, typeName)) {
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
