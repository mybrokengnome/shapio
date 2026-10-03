import type { UsageMeter } from '../../assist/completion.js';
import { assistDisabled } from '../../assist/errors.js';
import { ASSIST_CONTENT_OPS_MAX_FINDINGS, type ContentOpsRule } from '../../constants/assist.js';
import type { ContentModel } from '../../content/model.js';
import { resolveModel } from '../../content/model.js';
import { AppError } from '../../helpers/appError.js';
import { PermanentJobError, type JobContext } from '../../jobs/types.js';
import type { MediaStorage } from '../../media/types.js';
import { jobContentContext, type PublishingJobEnvironment } from '../../publishing/jobEnvironment.js';
import { loadActor } from '../../publishing/principals.js';
import * as assistRunsRepository from '../../repositories/assistRuns.js';
import type { AssistRunRow } from '../../repositories/assistRuns.js';
import * as mediaAssetsRepository from '../../repositories/mediaAssets.js';
import { recordAudit } from '../audit.js';
import { addEntryItem, createChangeSet } from '../changeSets.js';
import { modelWithPolicy } from '../contentAccess.js';
import { updateEntry } from '../contentEntries.js';
import { listFindings, type FindingView } from '../contentHealthReads.js';
import { proposeAltText } from './altText.js';
import { CONTENT_OPS_PERMISSIONS, type ContentOpsJobPayload } from './contentOps.js';
import type { AssistRuntime, AssistServiceContext } from './context.js';
import { loadEntryDraft } from './entrySource.js';
import { auditMetadataOf } from './runs.js';
import { toInputFormat, translatableFields, translateDocument } from './translate.js';

/** What the content-ops job needs besides the job: the publishing job environment, assist and storage. */
export type ContentOpsJobDependencies = {
  environment: PublishingJobEnvironment;
  assist: AssistRuntime | undefined;
  storage: MediaStorage;
};

export type AltProposal = {
  assetId: string;
  filename: string;
  currentAlt: string;
  proposedAlt: string;
  /** Send as `expectedVersion` when applying through PATCH /api/admin/media/assets/:id. */
  assetVersion: number;
  findingCount: number;
};

export type Skipped = {
  key: string;
  entryId?: string;
  assetId?: string;
  locale?: string;
  reason: string;
  detail?: unknown;
};
export type Written = { entryId: string; modelKey: string; locale: string; version: number };

export type ContentOpsResult =
  | { rule: 'altMissing'; proposals: AltProposal[]; skipped: Skipped[] }
  | {
      rule: 'localeMissing';
      changeSetId: string | null;
      fromLocale: string;
      written: Written[];
      skipped: Skipped[];
    };

/** Progress kept across attempts: finished items are not redone (their drafts already exist). */
type Checkpoint = {
  meter: { inputTokens: number; outputTokens: number; model: string; calls: number };
  done: string[];
  changeSetId: string | null;
  proposals: AltProposal[];
  written: Written[];
  skipped: Skipped[];
};

const emptyCheckpoint = (model: string): Checkpoint => ({
  meter: { inputTokens: 0, outputTokens: 0, model, calls: 0 },
  done: [],
  changeSetId: null,
  proposals: [],
  written: [],
  skipped: [],
});

/** Open findings of the rule the actor may see, newest first, at most ASSIST_CONTENT_OPS_MAX_FINDINGS. */
const loadFindings = async (context: AssistServiceContext, rule: ContentOpsRule, modelKey: string | null) => {
  const findings: FindingView[] = [];
  let cursor: string | undefined;
  do {
    const page = await listFindings(context, {
      rule,
      ...(modelKey ? { modelKey } : {}),
      ...(cursor ? { cursor } : {}),
      limit: ASSIST_CONTENT_OPS_MAX_FINDINGS,
    });
    findings.push(...page.items);
    cursor = page.nextCursor ?? undefined;
  } while (cursor && findings.length < ASSIST_CONTENT_OPS_MAX_FINDINGS);
  return findings.slice(0, ASSIST_CONTENT_OPS_MAX_FINDINGS);
};

const reasonOf = (error: unknown) => (error instanceof AppError ? error.code : 'INTERNAL_ERROR');

/** Errors that end the whole run: every further item would fail the same way. */
const isRunFatal = (error: unknown) =>
  error instanceof AppError &&
  ['ASSIST_VISION_UNSUPPORTED', 'ASSIST_PROVIDER_AUTH', 'ACTOR_UNAVAILABLE'].includes(error.code);

type RunState = {
  job: JobContext;
  context: AssistServiceContext;
  meter: UsageMeter;
  checkpoint: Checkpoint;
};

const saveProgress = async (state: RunState) => {
  state.checkpoint.meter = { ...state.meter };
  await state.job.saveCheckpoint(state.checkpoint);
};

/** `altMissing`: one proposed library alt text per asset of the findings; nothing is written. */
const proposeAlts = async (state: RunState, findings: readonly FieldlessFinding[]) => {
  const counts = new Map<string, number>();
  for (const finding of findings) {
    const assetId = finding.params.assetId;
    if (typeof assetId === 'string') {
      counts.set(assetId, (counts.get(assetId) ?? 0) + 1);
    }
  }
  for (const [assetId, findingCount] of counts) {
    const key = `asset:${assetId}`;
    if (state.checkpoint.done.includes(key) || state.job.signal.aborted) {
      continue;
    }
    const asset = await mediaAssetsRepository.findLiveOnSite(
      state.context.site.id,
      assetId,
      state.context.db,
    );
    if (!asset) {
      state.checkpoint.skipped.push({ key, assetId, reason: 'assetMissing' });
    } else if (asset.alt.trim() !== '') {
      state.checkpoint.skipped.push({ key, assetId, reason: 'altAddedMeanwhile' });
    } else {
      try {
        const proposedAlt = await proposeAltText(
          state.context,
          state.meter,
          asset,
          state.context.snapshot.defaultLocale,
        );
        state.checkpoint.proposals.push({
          assetId,
          filename: asset.original_filename,
          currentAlt: asset.alt,
          proposedAlt,
          assetVersion: asset.version,
          findingCount,
        });
      } catch (error) {
        if (isRunFatal(error)) {
          throw error;
        }
        state.checkpoint.skipped.push({ key, assetId, reason: reasonOf(error) });
      }
    }
    state.checkpoint.done.push(key);
    await saveProgress(state);
  }
};

type FieldlessFinding = Pick<FindingView, 'entryId' | 'modelKey' | 'locale' | 'params'>;

/** The change set the drafts go into, opened on the first written draft. */
const changeSetFor = async (state: RunState) => {
  if (!state.checkpoint.changeSetId) {
    const created = await createChangeSet(state.context, {
      title: `Missing locales, proposed by ${state.meter.model}`,
      description:
        'Locale drafts proposed by assist (content-ops, rule localeMissing). Review each draft before shipping.',
      source: 'assist',
    });
    state.checkpoint.changeSetId = created.id;
    await saveProgress(state);
  }
  return state.checkpoint.changeSetId;
};

/**
 * One missing (entry, locale): translated from the source locale and written as the locale's first draft
 * through the normal save path, guarded by `expectedVersion: null` (it must still have no head). Models
 * without drafts are skipped: saving there publishes.
 */
const writeLocaleDraft = async (
  state: RunState,
  finding: FieldlessFinding,
  fromLocale: string,
): Promise<Omit<Skipped, 'key'> | Written> => {
  const target = finding.locale;
  let model: ContentModel;
  try {
    model = resolveModel(state.context.snapshot, finding.modelKey);
  } catch {
    return { entryId: finding.entryId, locale: target, reason: 'modelMissing' };
  }
  if (!model.definition.draftAndPublish) {
    return { entryId: finding.entryId, locale: target, reason: 'publishesOnSave' };
  }
  if (target === fromLocale) {
    return { entryId: finding.entryId, locale: target, reason: 'sourceLocale' };
  }
  const { policy: readPolicy } = await modelWithPolicy(state.context, finding.modelKey, 'read');
  const { policy: updatePolicy } = await modelWithPolicy(state.context, finding.modelKey, 'update');
  let source;
  try {
    source = await loadEntryDraft(state.context, model, readPolicy, finding.entryId, fromLocale);
  } catch (error) {
    if (error instanceof AppError && error.statusCode === 404) {
      return { entryId: finding.entryId, locale: target, reason: 'sourceMissing' };
    }
    throw error;
  }
  if (source.drafts.some((head) => head.locale === target)) {
    return { entryId: finding.entryId, locale: target, reason: 'localeCreatedMeanwhile' };
  }
  const fields = translatableFields(model, readPolicy, updatePolicy);
  const translated = await translateDocument(state.context, state.meter, {
    model,
    fields,
    data: source.draft.data,
    from: fromLocale,
    to: target,
  });
  try {
    const view = await updateEntry(state.context, finding.modelKey, finding.entryId, {
      locale: target,
      expectedVersion: null,
      data: toInputFormat(model, fields, translated.data),
    });
    return { entryId: finding.entryId, modelKey: finding.modelKey, locale: target, version: view.version };
  } catch (error) {
    if (error instanceof AppError && error.code === 'CONTENT_VERSION_CONFLICT') {
      return { entryId: finding.entryId, locale: target, reason: 'localeCreatedMeanwhile' };
    }
    if (error instanceof AppError && error.code === 'CONTENT_INVALID') {
      return { entryId: finding.entryId, locale: target, reason: 'invalid', detail: error.details };
    }
    throw error;
  }
};

const proposeLocales = async (state: RunState, findings: readonly FieldlessFinding[], fromLocale: string) => {
  for (const finding of findings) {
    const key = `entry:${finding.entryId}:${finding.locale}`;
    if (state.checkpoint.done.includes(key) || state.job.signal.aborted) {
      continue;
    }
    let outcome: Omit<Skipped, 'key'> | Written;
    try {
      outcome = await writeLocaleDraft(state, finding, fromLocale);
    } catch (error) {
      if (isRunFatal(error)) {
        throw error;
      }
      outcome = { entryId: finding.entryId, locale: finding.locale, reason: reasonOf(error) };
    }
    if ('reason' in outcome) {
      state.checkpoint.skipped.push({ key, ...outcome });
    } else {
      const changeSetId = await changeSetFor(state);
      await addEntryItem(state.context, changeSetId, {
        modelKey: outcome.modelKey,
        entryId: outcome.entryId,
        locale: outcome.locale,
        action: 'publish',
      });
      state.checkpoint.written.push(outcome);
    }
    state.checkpoint.done.push(key);
    await saveProgress(state);
  }
};

/** Marks the run finished and records the `assist.content_ops` audit event, in one transaction. */
const finishRun = (
  state: Pick<RunState, 'context' | 'meter'>,
  run: AssistRunRow,
  outcome: { errorCode: string | null; counts: Record<string, unknown> },
) =>
  state.context.db.transaction().execute(async (trx) => {
    const finishedAt = new Date();
    const updated = await assistRunsRepository.update(
      run.id,
      {
        status: outcome.errorCode ? 'failed' : 'succeeded',
        error_code: outcome.errorCode,
        model: state.meter.model,
        input_tokens: state.meter.inputTokens,
        output_tokens: state.meter.outputTokens,
        duration_ms: finishedAt.getTime() - run.created_at.getTime(),
        finished_at: finishedAt,
      },
      trx,
    );
    await recordAudit(trx, {
      actor: state.context.actor,
      action: 'assist.content_ops',
      target: { type: 'assist_run', id: run.id },
      outcome: outcome.errorCode ? 'failure' : 'success',
      metadata: { ...auditMetadataOf(updated ?? run), rule: run.rule, ...outcome.counts },
      site: state.context.site,
    });
  });

const markFailed = (deps: ContentOpsJobDependencies, run: AssistRunRow, errorCode: string) =>
  assistRunsRepository.update(
    run.id,
    { status: 'failed', error_code: errorCode, finished_at: new Date() },
    deps.environment.runtime.db,
  );

const countsOf = (result: ContentOpsResult) =>
  result.rule === 'altMissing'
    ? { proposals: result.proposals.length, skipped: result.skipped.length }
    : { changeSetId: result.changeSetId, written: result.written.length, skipped: result.skipped.length };

const resultOf = (rule: ContentOpsRule, checkpoint: Checkpoint, fromLocale: string): ContentOpsResult =>
  rule === 'altMissing'
    ? { rule, proposals: checkpoint.proposals, skipped: checkpoint.skipped }
    : {
        rule,
        changeSetId: checkpoint.changeSetId,
        fromLocale,
        written: checkpoint.written,
        skipped: checkpoint.skipped,
      };

/** The context the run works in: the actor as they are now (roles re-checked), on the run's site. */
const runContext = async (
  deps: ContentOpsJobDependencies,
  assist: AssistRuntime,
  run: AssistRunRow,
): Promise<AssistServiceContext> => {
  const actor = await loadActor(
    deps.environment.runtime.db,
    {
      adminUserId: run.actor_type === 'admin' ? run.actor_id : null,
      tokenId: run.actor_type === 'token' ? run.actor_id : null,
    },
    `assist:${run.id}`,
    run.site_id,
  );
  const content = await jobContentContext(deps.environment, actor, run.site_id);
  return { ...content, assist, storage: deps.storage };
};

/** The `assist.contentOps` job: see services/assist/contentOps.ts. Returns the run's result (the job result). */
export const runContentOpsJob = async (
  deps: ContentOpsJobDependencies,
  job: JobContext,
): Promise<ContentOpsResult> => {
  const payload = job.payload as ContentOpsJobPayload;
  const run = await assistRunsRepository.findById(payload.runId, deps.environment.runtime.db);
  if (!run) {
    throw new PermanentJobError(`Assist run ${payload.runId} no longer exists`);
  }
  if (!deps.assist) {
    await markFailed(deps, run, 'ASSIST_DISABLED');
    throw new PermanentJobError(assistDisabled().message);
  }
  const lastAttempt = job.attempt >= job.maxAttempts;
  let state: RunState | undefined;
  try {
    const context = await runContext(deps, deps.assist, run);
    if (!(await context.permissions.canPerform(context.actor, CONTENT_OPS_PERMISSIONS[payload.rule].start))) {
      throw new AppError(
        403,
        'FORBIDDEN',
        `The actor's role no longer allows ${CONTENT_OPS_PERMISSIONS[payload.rule].start}`,
      );
    }
    const checkpoint = (job.checkpoint as Checkpoint | null) ?? emptyCheckpoint(deps.assist.config.model);
    state = { job, context: { ...context, signal: job.signal }, meter: { ...checkpoint.meter }, checkpoint };
    await assistRunsRepository.update(run.id, { status: 'running' }, context.db);
    const fromLocale = payload.fromLocale ?? context.snapshot.defaultLocale;
    const findings = await loadFindings(state.context, payload.rule, payload.modelKey);
    if (payload.rule === 'altMissing') {
      await proposeAlts(state, findings);
    } else {
      await proposeLocales(state, findings, fromLocale);
    }
    if (job.signal.aborted) {
      throw new Error('Stopped by shutdown; the next attempt resumes from the checkpoint');
    }
    const result = resultOf(payload.rule, state.checkpoint, fromLocale);
    await finishRun(state, run, { errorCode: null, counts: countsOf(result) });
    return result;
  } catch (error) {
    const permanent = error instanceof AppError || error instanceof PermanentJobError;
    if (permanent || lastAttempt) {
      const errorCode = reasonOf(error);
      if (state) {
        await finishRun(state, run, { errorCode, counts: {} });
      } else {
        await markFailed(deps, run, errorCode);
      }
      throw new PermanentJobError(error instanceof Error ? error.message : String(error), { cause: error });
    }
    throw error;
  }
};
