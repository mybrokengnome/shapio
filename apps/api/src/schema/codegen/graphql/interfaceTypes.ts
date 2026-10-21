import {
  ANY_TARGET,
  isInterfaceDefinition,
  type FieldDefinition,
  type InterfaceDefinition,
} from '@shapio/schema';
import { GraphQLInterfaceType } from 'graphql';
import { liveFields } from '../../../content/model.js';
import type { RelationTarget } from '../../../content/relationTarget.js';
import { memoType, type SchemaBuild } from './build.js';
import type { ValueNode } from './context.js';
import { describeDefinition } from './descriptions.js';
import { readableMemberIds, resolvedModelById, rowTypeName } from './entryKinds.js';
import { modelTypeName } from './names.js';
import {
  fieldConfigs,
  list,
  LOCALIZATIONS_DESCRIPTION,
  localizationsCost,
  systemFields,
} from './outputTypes.js';
import { readableFields } from './visibility.js';

/**
 * GraphQL interfaces beyond model families (plan interfaces D8):
 *
 * - `Entry`: the system fields only. Every entry object type and every generated interface implements it, and
 *   a relation to any entry returns it. Always in the schema.
 * - An interface definition (`Featurable`): the system fields, `localizations`, and its contract fields that
 *   every member the caller may read exposes (the intersection), so every implementing type has every field
 *   with the same type and the schema stays valid under any read mask. Enum contract fields are left out
 *   (enum types are named per declaring model, decision 4). In the schema when at least one member is
 *   readable. Rows resolve to their member's type through `__model`.
 */
export const ENTRY_TYPE_NAME = 'Entry';

const ANY_ENTRY: RelationTarget = { kind: 'any' };

export const entryInterface = (build: SchemaBuild): GraphQLInterfaceType =>
  memoType(
    build.contracts,
    ANY_TARGET,
    () =>
      new GraphQLInterfaceType({
        name: ENTRY_TYPE_NAME,
        description: 'Any entry, of any type: its system fields. Select its fields with `... on <Type>`.',
        fields: systemFields,
        resolveType: (node: ValueNode) => rowTypeName(build, ANY_ENTRY, node),
      }),
  ) as GraphQLInterfaceType;

export const interfaceById = (build: SchemaBuild, id: string): InterfaceDefinition | undefined => {
  const definition = build.snapshot.byId.get(id)?.definition;
  return definition && isInterfaceDefinition(definition) ? definition : undefined;
};

/**
 * The contract fields the interface exposes to this caller: those whose matching field every readable member
 * has in the caller's read mask (outputs, filters and sorts). Enum fields are never exposed.
 */
export const contractFields = (build: SchemaBuild, definition: InterfaceDefinition): FieldDefinition[] => {
  const members = readableMemberIds(build, definition.id).flatMap(
    (id) => resolvedModelById(build.snapshot, id) ?? [],
  );
  const readable = members.map(
    (member) => new Set(readableFields(build.visibility, member).map((field) => field.id)),
  );
  return liveFields(definition.fields).filter(
    (field) =>
      field.type !== 'enum' &&
      members.every((member, index) => {
        const memberField = build.snapshot.memberFieldOf(definition.id, field.id, member.id);
        return memberField !== undefined && readable[index]?.has(memberField.id) === true;
      }),
  );
};

/** The target an interface definition's queries and relations serve: its members. */
export const interfaceTarget = (build: SchemaBuild, interfaceId: string): RelationTarget => ({
  kind: 'interface',
  id: interfaceId,
  modelIds: build.snapshot.implementedBy(interfaceId),
});

/** An interface definition's GraphQL interface; null when the caller may read none of its members. */
export const contractType = (
  build: SchemaBuild,
  definition: InterfaceDefinition,
): GraphQLInterfaceType | null =>
  memoType(build.contracts, definition.id, () => {
    if (readableMemberIds(build, definition.id).length === 0) {
      return null;
    }
    const target = interfaceTarget(build, definition.id);
    const type: GraphQLInterfaceType = new GraphQLInterfaceType({
      name: modelTypeName(definition),
      description: describeDefinition(definition),
      interfaces: () => [entryInterface(build)],
      fields: () => ({
        ...systemFields(),
        localizations: {
          type: list(type),
          description: LOCALIZATIONS_DESCRIPTION,
          extensions: localizationsCost(build),
        },
        ...fieldConfigs(build, definition, contractFields(build, definition), true),
      }),
      resolveType: (node: ValueNode) => rowTypeName(build, target, node),
    });
    return type;
  });

/** The GraphQL interfaces of the interface definitions a model implements (its own and its ancestors'). */
export const memberContractTypes = (build: SchemaBuild, modelId: string): GraphQLInterfaceType[] =>
  build.snapshot.interfacesOf(modelId).flatMap((id) => {
    const definition = interfaceById(build, id);
    return (definition && contractType(build, definition)) ?? [];
  });
