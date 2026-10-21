import { isModelDefinition, type ModelDefinition } from '@shapio/schema';
import { compileHeadQuery } from '../content/compiler/compile.js';
import { compileRowFilter } from '../content/compiler/policy.js';
import { familyIdsOf } from '../content/family.js';
import { readScopeFor } from '../content/locales.js';
import type { Policy } from '../permissions/types.js';
import * as contentQueriesRepository from '../repositories/contentQueries.js';
import * as entriesRepository from '../repositories/entries.js';
import type { ContentServiceContext } from './contentAccess.js';

/**
 * Entries per model for the places in the sidebar, for the models the caller may read. Models without a
 * row filter are counted together with one GROUP BY on `entries`; the others through the content compiler
 * with the caller's row filter (the number their list would show). A model with kinds counts its family
 * (plan polymorphic-types): its list shows every kind the caller may read.
 */
export type ContentCountView = { modelId: string; modelKey: string; total: number };

type Readable = { definition: ModelDefinition; policy: Policy };

const countFiltered = async (context: ContentServiceContext, { definition, policy }: Readable) => {
  const rowFilter = compileRowFilter(policy.rowFilter, context.actor);
  const compiled = compileHeadQuery({
    siteId: context.site.id,
    members: [{ modelId: definition.id }],
    source: { kind: 'heads', state: 'draft' },
    locales: readScopeFor(context.snapshot, definition, undefined, { fallback: true }),
    conditions: rowFilter ? [rowFilter] : [],
    orderBy: [],
    limit: 1,
  });
  return contentQueriesRepository.runCountQuery(compiled.count, context.db);
};

export const countContent = async (
  context: ContentServiceContext,
): Promise<{ counts: ContentCountView[] }> => {
  const models = context.snapshot.definitions.map((active) => active.definition).filter(isModelDefinition);
  const policies = await Promise.all(
    models.map((definition) =>
      context.permissions.evaluate(context.actor, { action: 'read', modelId: definition.id }),
    ),
  );
  const readable = models
    .map((definition, index) => ({ definition, policy: policies[index] as Policy }))
    .filter((model) => model.policy.allowed);
  const grouped = await entriesRepository.countLiveByModel(
    context.site.id,
    readable.filter((model) => model.policy.rowFilter === null).map((model) => model.definition.id),
    context.db,
  );
  const totals = new Map(grouped.map((row) => [row.model_id, Number(row.count)]));
  for (const model of readable.filter((candidate) => candidate.policy.rowFilter !== null)) {
    totals.set(model.definition.id, await countFiltered(context, model));
  }
  const readableIds = new Set(readable.map(({ definition }) => definition.id));
  const familyTotal = (modelId: string) =>
    familyIdsOf(context.snapshot, modelId)
      .filter((id) => readableIds.has(id))
      .reduce((sum, id) => sum + (totals.get(id) ?? 0), 0);
  return {
    counts: readable.map(({ definition }) => ({
      modelId: definition.id,
      modelKey: definition.apiKey,
      total: familyTotal(definition.id),
    })),
  };
};
