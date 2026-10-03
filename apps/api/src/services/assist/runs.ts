import { createUsageMeter, type UsageMeter } from '../../assist/completion.js';
import type { AssistAction } from '../../constants/assist.js';
import { AppError } from '../../helpers/appError.js';
import * as assistRunsRepository from '../../repositories/assistRuns.js';
import type { AssistRunRow } from '../../repositories/assistRuns.js';
import { actorColumns } from '../../schema/planner/actor.js';
import { recordAudit } from '../audit.js';
import type { AssistServiceContext } from './context.js';

/** What a run is about, for its audit row. Metadata only: never prompts, content or model output. */
export type AssistRunSpec = {
  action: AssistAction;
  target?: { type: string; id: string };
  metadata?: Record<string, unknown>;
};

type Recorded = { meter: UsageMeter; durationMs: number; errorCode: string | null };

const errorCodeOf = (error: unknown) => (error instanceof AppError ? error.code : 'INTERNAL_ERROR');

/** The run row and the `assist.<action>` audit event of a finished run, in one transaction. */
const recordRun = (context: AssistServiceContext, spec: AssistRunSpec, recorded: Recorded) =>
  context.db.transaction().execute(async (trx) => {
    const actor = actorColumns(context.actor);
    const now = new Date();
    const run = await assistRunsRepository.insert(
      {
        site_id: context.site.id,
        actor_type: actor.type,
        actor_id: actor.id ?? '',
        action: spec.action,
        provider: context.assist.provider.id,
        model: recorded.meter.model,
        input_tokens: recorded.meter.inputTokens,
        output_tokens: recorded.meter.outputTokens,
        duration_ms: recorded.durationMs,
        status: recorded.errorCode ? 'failed' : 'succeeded',
        error_code: recorded.errorCode,
        created_at: new Date(now.getTime() - recorded.durationMs),
        finished_at: now,
      },
      trx,
    );
    await recordAudit(trx, {
      actor: context.actor,
      action: `assist.${spec.action}`,
      ...(spec.target ? { target: spec.target } : {}),
      outcome: recorded.errorCode ? 'failure' : 'success',
      metadata: { ...auditMetadataOf(run), ...spec.metadata },
      site: context.site,
      ...(context.requestId ? { requestId: context.requestId } : {}),
      ...(context.ip ? { ip: context.ip } : {}),
    });
    return run;
  });

export const auditMetadataOf = (run: AssistRunRow) => ({
  runId: run.id,
  provider: run.provider,
  model: run.model,
  inputTokens: run.input_tokens,
  outputTokens: run.output_tokens,
  durationMs: run.duration_ms,
  ...(run.error_code ? { errorCode: run.error_code } : {}),
});

/**
 * Runs one assist request: the work gets a usage meter for its model calls; afterwards the run and its
 * audit event are recorded whether it succeeded or failed, and a failure is rethrown.
 */
export const runAssist = async <T>(
  context: AssistServiceContext,
  spec: AssistRunSpec,
  work: (meter: UsageMeter) => Promise<T>,
): Promise<T> => {
  const meter = createUsageMeter(context.assist.provider);
  const started = Date.now();
  try {
    const result = await work(meter);
    await recordRun(context, spec, { meter, durationMs: Date.now() - started, errorCode: null });
    return result;
  } catch (error) {
    try {
      await recordRun(context, spec, {
        meter,
        durationMs: Date.now() - started,
        errorCode: errorCodeOf(error),
      });
    } catch (recordError) {
      throw new AggregateError(
        [error, recordError],
        'The assist request failed, and recording the failed run failed too',
        { cause: recordError },
      );
    }
    throw error;
  }
};
