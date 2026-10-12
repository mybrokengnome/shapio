import type { FieldDefinition } from '@shapio/schema';
import * as mediaAssetsRepository from '../repositories/mediaAssets.js';
import { queryForbidden, type FilterNode, type FilterOperator } from './compiler/types.js';
import { resolveModelById } from './model.js';
import { fetchHeadsByIds, readPolicy, type ReadEnvironment } from './read.js';

/**
 * Relation and media filters see the IDs the response shows (delivery-api.md: "a filter can never reveal a
 * hidden value"). Stored IDs include links to unpublished entries, entries the caller may not read and
 * force-deleted assets, which projection leaves out; a filter naming such an ID is rewritten as if the value
 * were not there, so nobody can probe whether an entry links to a hidden ID. Delivery reads refuse filters on a
 * relation into a model the caller may not read (403, like a hidden field). Admin reads see every relation
 * ID, so only media are rewritten for them.
 */

type Condition = Extract<FilterNode, { kind: 'condition' }>;
type ReferenceField = FieldDefinition & { type: 'relation' | 'media' };

const ID_OPERATORS: ReadonlySet<FilterOperator> = new Set(['$eq', '$ne', '$in', '$nin']);

const referenceFieldOf = (node: Condition): ReferenceField | undefined =>
  node.target.kind === 'field' &&
  (node.target.field.type === 'relation' || node.target.field.type === 'media')
    ? node.target.field
    : undefined;

const conditionsOf = (node: FilterNode): Condition[] => {
  switch (node.kind) {
    case 'and':
    case 'or':
      return node.nodes.flatMap(conditionsOf);
    case 'not':
      return conditionsOf(node.node);
    case 'condition':
      return [node];
  }
};

const idsOf = (node: Condition): string[] =>
  ID_OPERATORS.has(node.operator) ? (Array.isArray(node.value) ? node.value : [node.value]).map(String) : [];

/** The IDs these conditions name that the read shows, per field: relation targets and live assets. */
const visibleIds = async (
  env: ReadEnvironment,
  conditions: readonly Condition[],
): Promise<Map<string, ReadonlySet<string>>> => {
  const visible = new Map<string, ReadonlySet<string>>();
  for (const node of conditions) {
    const field = referenceFieldOf(node);
    if (!field || visible.has(field.id)) {
      continue;
    }
    const ids = [
      ...new Set(conditions.filter((other) => referenceFieldOf(other)?.id === field.id).flatMap(idsOf)),
    ];
    if (field.type === 'media') {
      if (env.media) {
        const assets = await mediaAssetsRepository.findLiveManyOnSite(env.siteId, ids, env.executor);
        visible.set(field.id, new Set(assets.map((asset) => asset.id)));
      }
      continue;
    }
    if (env.audience === 'admin') {
      continue;
    }
    const policy = await readPolicy(env, field.settings.target);
    if (!policy.allowed) {
      throw queryForbidden(
        `You may not filter on "${field.apiKey}": you may not read the entries it links to`,
        {
          field: field.apiKey,
        },
      );
    }
    const target = resolveModelById(env.snapshot, field.settings.target);
    const rows = target ? await fetchHeadsByIds(env, target, policy, ids) : [];
    visible.set(field.id, new Set(rows.map((row) => row.entry_id)));
  }
  return visible;
};

/** A condition with the hidden IDs taken out: `$eq hidden` matches nothing, `$ne hidden` everything. */
const rewrite = (node: FilterNode, visible: ReadonlyMap<string, ReadonlySet<string>>): FilterNode => {
  switch (node.kind) {
    case 'and':
    case 'or':
      return { ...node, nodes: node.nodes.map((child) => rewrite(child, visible)) };
    case 'not':
      return { ...node, node: rewrite(node.node, visible) };
    case 'condition': {
      const shown = node.target.kind === 'field' ? visible.get(node.target.field.id) : undefined;
      if (!shown || !ID_OPERATORS.has(node.operator)) {
        return node;
      }
      const ids = idsOf(node).filter((id) => shown.has(id));
      const negated = node.operator === '$ne' || node.operator === '$nin';
      if (ids.length === idsOf(node).length) {
        return node;
      }
      return { ...node, operator: negated ? '$nin' : '$in', value: ids };
    }
  }
};

/** The query's filter with relation and media conditions limited to what this read shows. */
export const visibleReferenceFilter = async (
  env: ReadEnvironment,
  filter: FilterNode | null,
): Promise<FilterNode | null> => {
  if (!filter) {
    return null;
  }
  const conditions = conditionsOf(filter).filter((node) => referenceFieldOf(node) !== undefined);
  if (conditions.length === 0) {
    return filter;
  }
  return rewrite(filter, await visibleIds(env, conditions));
};
