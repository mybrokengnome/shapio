import type { AiProvider } from '../../config/assist.js';
import type { Database } from '../../db/index.js';
import type { PermissionEvaluator, Principal } from '../../permissions/types.js';
import * as assistRunsRepository from '../../repositories/assistRuns.js';
import type { SiteRef } from '../actorContext.js';
import type { AssistRuntime } from './context.js';

export type AssistUsageView = { month: string; runs: number; inputTokens: number; outputTokens: number };

export type AssistStatusView = {
  enabled: boolean;
  provider?: AiProvider;
  model?: string;
  /** This site's use this calendar month (UTC); only for people who see the Live page's change sets. */
  usage?: AssistUsageView;
};

type StatusContext = {
  db: Database;
  site: SiteRef;
  actor: Principal;
  permissions: PermissionEvaluator;
  now?: Date;
};

const monthStart = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

/** Whether assist is on, the configured model (never the key or the endpoint), and the month's usage. */
export const getAssistStatus = async (
  context: StatusContext,
  runtime: AssistRuntime | undefined,
): Promise<AssistStatusView> => {
  if (!runtime) {
    return { enabled: false };
  }
  const view: AssistStatusView = {
    enabled: true,
    provider: runtime.provider.id,
    model: runtime.config.model,
  };
  if (!(await context.permissions.canPerform(context.actor, 'changes.manage'))) {
    return view;
  }
  const since = monthStart(context.now ?? new Date());
  const row = await assistRunsRepository.usageSince(context.site.id, since, context.db);
  return {
    ...view,
    usage: {
      month: since.toISOString().slice(0, 7),
      runs: Number(row.runs),
      inputTokens: Number(row.input_tokens),
      outputTokens: Number(row.output_tokens),
    },
  };
};
