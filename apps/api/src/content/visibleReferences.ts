import { ANY_TARGET, isInterfaceDefinition, isModelDefinition, type FieldDefinition } from '@shapio/schema';
import * as mediaAssetsRepository from '../repositories/mediaAssets.js';
import { queryForbidden, type FilterNode, type FilterOperator, type ShownTargets } from './compiler/types.js';
import { readableMembers } from './family.js';
import { readScopeFor } from './locales.js';
import { resolveModelById } from './model.js';
import { fetchFamilyHeadsByIds, fetchTargetHeadsByIds, readPolicy, type ReadEnvironment } from './read.js';
import { relationTargetFor } from './relationTarget.js';

/**
 * Relation and media filters see the IDs the response shows (delivery-api.md: "a filter can never reveal a
 * hidden value"). Stored IDs include links to unpublished entries, entries the caller may not read and
 * force-deleted assets, which projection leaves out; a filter naming such an ID is rewritten as if the value
 * were not there, so nobody can probe whether an entry links to a hidden ID. Delivery reads refuse filters on a
 * relation into a model the caller may not read (403, like a hidden field). Admin reads see every relation
 * ID, so only media are rewritten for them. `$null`/`$notNull` get the rule for what is shown, which the
 * compiler checks per entry, so an entry whose references are all hidden counts as null.
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

/** Per reference field: which of the IDs the conditions name the read shows, and the rule for what it shows. */
type FieldVisibility = { ids: ReadonlySet<string>; shown: ShownTargets };

/**
 * The readable models a relation's target accepts, each with its policy: a model's family, an interface's
 * members, or every collection and singleton of the view (any entry). Delivery refuses a filter on a relation
 * whose targets the caller may read none of (403, like a hidden field).
 */
const readableTargets = async (env: ReadEnvironment, field: ReferenceField & { type: 'relation' }) => {
  const target = relationTargetFor(env.snapshot, field.settings.target);
  const modelIds =
    target.kind === 'any'
      ? env.snapshot.definitions.flatMap(({ definition }) =>
          isModelDefinition(definition) ? [definition.id] : [],
        )
      : target.modelIds;
  const members = await readableMembers(env.snapshot, modelIds, (modelId) => readPolicy(env, modelId));
  return { target, members };
};

/** What a delivery read shows of a relation field: which of `ids` it shows, and the rule for `$null`. */
const relationVisibility = async (
  env: ReadEnvironment,
  field: ReferenceField & { type: 'relation' },
  ids: readonly string[],
): Promise<FieldVisibility> => {
  if (field.settings.target !== ANY_TARGET && !isInterfaceTarget(env, field.settings.target)) {
    return modelVisibility(env, field, ids);
  }
  const { target, members } = await readableTargets(env, field);
  if (members.length === 0) {
    throw forbiddenFilter(field);
  }
  const heads = await fetchTargetHeadsByIds(env, target, ids);
  return {
    ids: new Set(heads.rows.map((row) => row.entry_id)),
    // Every readable model the target accepts, each under its own row filter and in its own locale scope,
    // so `$null` agrees with what projection shows (plan interfaces, decision 7).
    shown: {
      kind: 'relation',
      siteId: env.siteId,
      members: members.map(({ model, policy }) => ({
        modelId: model.definition.id,
        rowFilter: policy.rowFilter,
        locales: readScopeFor(env.snapshot, model.definition, env.locale, { fallback: true }),
      })),
      source: env.source,
      locales: { kind: 'any' },
      actor: env.actor,
    },
  };
};

const isInterfaceTarget = (env: ReadEnvironment, target: string): boolean => {
  const definition = env.snapshot.byId.get(target)?.definition;
  return definition !== undefined && isInterfaceDefinition(definition);
};

const forbiddenFilter = (field: ReferenceField) =>
  queryForbidden(`You may not filter on "${field.apiKey}": you may not read the entries it links to`, {
    field: field.apiKey,
  });

/** A relation to a model (and its kinds): the rule as it has always been. */
const modelVisibility = async (
  env: ReadEnvironment,
  field: ReferenceField & { type: 'relation' },
  ids: readonly string[],
): Promise<FieldVisibility> => {
  const policy = await readPolicy(env, field.settings.target);
  if (!policy.allowed) {
    throw forbiddenFilter(field);
  }
  const target = resolveModelById(env.snapshot, field.settings.target);
  if (!target) {
    return { ids: new Set(), shown: { kind: 'none' } };
  }
  const heads = await fetchFamilyHeadsByIds(env, target, ids);
  return {
    ids: new Set(heads.rows.map((row) => row.entry_id)),
    // The same heads `fetchFamilyHeadsByIds` reads (every kind of the target the caller may read, each
    // under its own row filter), so filters and projection agree.
    shown: {
      kind: 'relation',
      siteId: env.siteId,
      members: heads.members.map((member) => ({
        modelId: member.model.definition.id,
        rowFilter: member.policy.rowFilter,
      })),
      source: env.source,
      locales: readScopeFor(env.snapshot, target.definition, env.locale, { fallback: true }),
      actor: env.actor,
    },
  };
};

/** What the read shows of these conditions' fields: relation targets and live assets. */
const visibleIds = async (
  env: ReadEnvironment,
  conditions: readonly Condition[],
): Promise<Map<string, FieldVisibility>> => {
  const visible = new Map<string, FieldVisibility>();
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
        visible.set(field.id, {
          ids: new Set(assets.map((asset) => asset.id)),
          shown: { kind: 'media', siteId: env.siteId },
        });
      }
      continue;
    }
    if (env.audience === 'admin') {
      continue;
    }
    visible.set(field.id, await relationVisibility(env, field, ids));
  }
  return visible;
};

/**
 * A condition limited to what the read shows: `$eq hidden` matches nothing, `$ne hidden` everything, and
 * `$null`/`$notNull` carry the rule for what is shown.
 */
const rewrite = (node: FilterNode, visible: ReadonlyMap<string, FieldVisibility>): FilterNode => {
  switch (node.kind) {
    case 'and':
    case 'or':
      return { ...node, nodes: node.nodes.map((child) => rewrite(child, visible)) };
    case 'not':
      return { ...node, node: rewrite(node.node, visible) };
    case 'condition': {
      const field = node.target.kind === 'field' ? visible.get(node.target.field.id) : undefined;
      if (!field) {
        return node;
      }
      if (node.operator === '$null' || node.operator === '$notNull') {
        return { ...node, shownTargets: field.shown };
      }
      if (!ID_OPERATORS.has(node.operator)) {
        return node;
      }
      const ids = idsOf(node).filter((id) => field.ids.has(id));
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
