import { isInterfaceDefinition, type FieldDefinition } from '@shapio/schema';
import type { Policy } from '../../permissions/types.js';
import { groupByMember } from '../family.js';
import type { ContentModel } from '../model.js';
import type { FamilyHeads, ReadEnvironment } from '../read.js';
import type { HeadRow } from './compile.js';
import type { PopulateTree } from './types.js';

/**
 * Relation expansion (`populate`). Depth is bounded by the parser (QUERY_LIMITS.maxPopulateDepth); each
 * level applies the *target* model's read policy (row filter and read mask) and, for delivery, reads only
 * published targets. A target the caller may not read is left out, never shown partially. A relation to a
 * model with kinds reads the targets over its family in one query and projects each with its own kind's
 * policy and fields (plan polymorphic-types).
 */
export type PopulateEnvironment = ReadEnvironment & {
  /** Target heads by ID for a relation's stored target (a model, an interface, or `*`). */
  fetch: (env: ReadEnvironment, target: string, ids: readonly string[]) => Promise<FamilyHeads>;
  project: (
    env: ReadEnvironment,
    model: ContentModel,
    policy: Policy,
    rows: readonly HeadRow[],
    query: { fields: null; populate: PopulateTree },
  ) => Promise<Array<{ row: HeadRow; data: Record<string, unknown> }>>;
  system: (env: ReadEnvironment, row: HeadRow) => Record<string, unknown>;
};

const idsOf = (rows: readonly HeadRow[], fieldId: string): string[] => {
  const ids = new Set<string>();
  for (const row of rows) {
    const value = row.data[fieldId];
    for (const id of Array.isArray(value) ? value : [value]) {
      if (typeof id === 'string') {
        ids.add(id);
      }
    }
  }
  return [...ids];
};

/** A populate tree of contract field IDs as the member's own field IDs (one level; deeper is the target's). */
const memberPopulate = (
  env: ReadEnvironment,
  interfaceId: string,
  modelId: string,
  tree: PopulateTree,
): PopulateTree =>
  new Map(
    [...tree].flatMap(([fieldId, subtree]) => {
      const field = env.snapshot.memberFieldOf(interfaceId, fieldId, modelId);
      return field ? [[field.id, subtree] as const] : [];
    }),
  );

/** relation field ID → target entry ID → projected target entry. */
export const populateRelations = async (
  env: PopulateEnvironment,
  rows: readonly HeadRow[],
  fields: readonly FieldDefinition[],
  tree: PopulateTree,
): Promise<Map<string, Map<string, unknown>>> => {
  const populated = new Map<string, Map<string, unknown>>();
  for (const [fieldId, subtree] of tree) {
    const field = fields.find((candidate) => candidate.id === fieldId);
    if (!field || field.type !== 'relation') {
      continue;
    }
    const byId = new Map<string, unknown>();
    populated.set(fieldId, byId);
    const target = field.settings.target;
    const heads = await env.fetch(env, target, idsOf(rows, fieldId));
    const contract = env.snapshot.byId.get(target)?.definition;
    for (const group of groupByMember(heads.members, heads.rows)) {
      const { model, policy } = group.member;
      // Below a relation to an interface the paths name contract fields: each member populates its own.
      const own =
        contract && isInterfaceDefinition(contract)
          ? memberPopulate(env, contract.id, model.definition.id, subtree)
          : subtree;
      for (const { row, data } of await env.project(env, model, policy, group.rows, {
        fields: null,
        populate: own,
      })) {
        byId.set(row.entry_id, { ...env.system(env, row), ...data });
      }
    }
  }
  return populated;
};
