import type { Transaction } from 'kysely';
import type { DB } from '../../db/types.js';
import * as contentRevisionsRepository from '../../repositories/contentRevisions.js';
import * as entryHeadsRepository from '../../repositories/entryHeads.js';
import type { ScannedHead } from '../../repositories/entryHeads.js';
import * as publicationsRepository from '../../repositories/publications.js';
import * as relationEdgesRepository from '../../repositories/relationEdges.js';
import * as uniqueValuesRepository from '../../repositories/uniqueValues.js';
import type { ActivationContext, StepOutcome } from '../../schema/planner/contentPorts.js';
import type { ContentStep } from '../../schema/planner/steps.js';
import type { SchemaById } from '../../schema/snapshot.js';
import { resolveModelById, type HeadState } from '../model.js';
import { edgesOf } from '../relations.js';
import { syncUniqueValues, uniqueFields } from '../unique.js';
import {
  checkEntry,
  outcomeOf,
  ownerOf,
  promoteStaged,
  registryFieldIdOf,
  singletonViolation,
  tallyFailures,
  type Tallies,
} from './checks.js';
import { isEntryLevelConversion } from './convert.js';
import { contentModelIds } from './dryRun.js';
import { convertEntry } from './entryConversions.js';
import { isTransformStep, proposalChangesStorage, proposeEntry, type TransformStep } from './propose.js';
import { loadProposedSnapshot } from './proposed.js';
import { scanEntries } from './scan.js';

/**
 * The content side of an activation (ADR 0002 pipeline), inside the activation transaction under the
 * exclusive model locks, so no entry write runs concurrently:
 * 1. the delta re-check: entries with a head written after the dry run's watermark are proposed and checked
 *    like the dry run did (their staged unique claims released and made anew first);
 * 2. the rewrite: when the change converts or backfills, every affected entry is written in its proposed
 *    form. Entries at or below the watermark passed the dry run unchanged since; the others just passed (1).
 * A failure rolls the whole transaction back, so storage stays as it was.
 */
type Context = {
  trx: Transaction<DB>;
  steps: readonly ContentStep[];
  proposed: SchemaById;
  activation: ActivationContext;
};

const recheckChanged = async (context: Context, watermark: string): Promise<Tallies> => {
  const { trx, steps, proposed } = context;
  const modelIds = contentModelIds(steps);
  const uniqueFieldIds = steps.flatMap((step) =>
    step.kind === 'checkUnique' ? [registryFieldIdOf(step)] : [],
  );
  // A changed entry may have given up a value another changed entry now uses: release all, then claim.
  if (uniqueFieldIds.length > 0) {
    await scanEntries(trx, { modelIds, changedAfterSeq: watermark, cursor: null }, async (heads) => {
      for (const fieldId of uniqueFieldIds) {
        await uniqueValuesRepository.removeForEntryField(heads[0]?.entry_id ?? '', fieldId, trx);
      }
    });
  }
  const transforms = steps.filter(isTransformStep);
  const tallies: Tallies = {};
  await scanEntries(trx, { modelIds, changedAfterSeq: watermark, cursor: null }, async (heads) => {
    const proposal = proposeEntry(heads, transforms, proposed.defaultLocale);
    tallyFailures(tallies, proposal.entryId, await checkEntry(proposal, steps, { proposed, executor: trx }));
  });
  return tallies;
};

/**
 * A converted head gets its own `conversion` revision (history stays exact, and `?snapshot=N` reads the
 * revision the log points at). A draft and published head that shared a revision share the new one, so an
 * unmodified entry stays unmodified. Converted published heads roll their publication-log row at the
 * activation's sequence number once every rewrite is done.
 */
type RevisionCache = Map<string, { data: string; revisionId: string }>;

const conversionRevision = async (
  context: Context,
  head: ScannedHead,
  data: ScannedHead['data'],
  cache: RevisionCache,
) => {
  const serialized = JSON.stringify(data);
  const cached = cache.get(head.revision_id);
  if (cached && cached.data === serialized) {
    return cached.revisionId;
  }
  const model = resolveModelById(context.proposed, head.model_id);
  const revision = await contentRevisionsRepository.insert(
    {
      entryId: head.entry_id,
      locale: head.locale,
      schemaRevisionId: model?.revisionId ?? '',
      data,
      reason: 'conversion',
      authorType: 'system',
      authorId: 'schema-convert',
      parentRevisionId: head.revision_id,
    },
    context.trx,
  );
  cache.set(head.revision_id, { data: serialized, revisionId: revision.id });
  return revision.id;
};

const rollPublication = (context: Context, head: ScannedHead, revisionId: string) =>
  context.activation.atSeq(head.site_id, async (seq) => {
    await publicationsRepository.close(head.entry_id, head.locale, seq, context.trx);
    await publicationsRepository.open(
      {
        entryId: head.entry_id,
        modelId: head.model_id,
        locale: head.locale,
        revisionId,
        seq,
        now: new Date(),
      },
      context.trx,
    );
  });

const rewriteHead = async (
  context: Context,
  head: ScannedHead,
  data: ScannedHead['data'],
  cache: RevisionCache,
) => {
  const revisionId = await conversionRevision(context, head, data, cache);
  const written = await entryHeadsRepository.rewriteData(
    { entryId: head.entry_id, locale: head.locale, state: head.state, changeSeq: head.change_seq },
    data,
    context.trx,
    revisionId,
  );
  const model = resolveModelById(context.proposed, head.model_id);
  if (written && model) {
    await relationEdgesRepository.replaceForHead(
      { entryId: head.entry_id, locale: head.locale, state: head.state as HeadState },
      edgesOf(model, data),
      context.trx,
    );
  }
  if (written && head.state === 'published') {
    rollPublication(context, head, revisionId);
  }
};

/** Writes one entry in its proposed form: entry-level conversions first, then converted values. */
const rewriteEntry = async (
  context: Context,
  stored: ScannedHead[],
  transforms: readonly TransformStep[],
) => {
  const { trx, proposed } = context;
  const [first] = stored;
  if (!first) {
    return;
  }
  const entryLevel = transforms.filter(
    (step) => step.kind === 'convert' && isEntryLevelConversion(step.change),
  );
  let heads = stored;
  if (entryLevel.length > 0) {
    for (const step of entryLevel) {
      if (step.kind === 'convert') {
        await convertEntry(trx, {
          entryId: first.entry_id,
          modelId: first.model_id,
          change: step.change,
          proposed,
          seqFor: context.activation.seqFor,
        });
      }
    }
    heads = await entryHeadsRepository.findForEntry(first.entry_id, trx);
  }
  const valueSteps = transforms.filter((step) => !entryLevel.includes(step));
  const proposal = proposeEntry(heads, valueSteps, proposed.defaultLocale);
  const cache: RevisionCache = new Map();
  for (const head of proposal.heads.filter((candidate) => candidate.changed)) {
    const original = heads.find(
      (candidate) => candidate.locale === head.locale && candidate.state === head.state,
    );
    if (original) {
      await rewriteHead(context, original, head.data, cache);
    }
  }
  // Registry rows follow the stored values (a conversion can change a unique value's normalized form).
  const model = resolveModelById(proposed, first.model_id);
  if (model) {
    await syncUniqueValues(trx, {
      entryId: first.entry_id,
      model: model.definition,
      fields: uniqueFields(model.definition),
      heads: await entryHeadsRepository.findForEntry(first.entry_id, trx),
    });
  }
};

const rewriteAll = async (context: Context) => {
  const transforms = context.steps.filter(isTransformStep);
  if (transforms.length === 0) {
    return;
  }
  await scanEntries(
    context.trx,
    { modelIds: contentModelIds(context.steps), cursor: null },
    async (heads) => {
      if (proposalChangesStorage(proposeEntry(heads, transforms, context.proposed.defaultLocale))) {
        await rewriteEntry(context, heads, transforms);
      }
    },
  );
};

export const applyChange = async (
  steps: readonly ContentStep[],
  watermark: unknown,
  trx: Transaction<DB>,
  activation: ActivationContext,
): Promise<StepOutcome> => {
  const proposed = await loadProposedSnapshot(trx, ownerOf(steps));
  const singleton = await singletonViolation(steps, proposed, trx);
  if (singleton) {
    return singleton;
  }
  const context: Context = { trx, steps, proposed, activation };
  const outcome = outcomeOf(
    steps,
    await recheckChanged(context, typeof watermark === 'string' ? watermark : '0'),
  );
  if (!outcome.ok) {
    return outcome;
  }
  // Before the rewrite re-syncs registry rows from the new values, so they already hold the new form.
  await promoteStaged(steps, trx);
  await rewriteAll(context);
  return { ok: true };
};
