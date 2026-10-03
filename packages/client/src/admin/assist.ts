import type { RequestFn } from '../request.js';
import type {
  AltTextInput,
  AltTextResult,
  AssistStatus,
  AssistTextResult,
  ContentOpsInput,
  ContentOpsRun,
  RewriteInput,
  SchemaDraftInput,
  SchemaDraftResult,
  SummarizeInput,
  TranslateInput,
  TranslateResult,
} from './assistTypes.js';
import { withId } from './paths.js';

export const ASSIST_PATHS = {
  status: '/api/admin/assist/status',
  altText: '/api/admin/assist/alt-text',
  summarize: '/api/admin/assist/summarize',
  translate: '/api/admin/assist/translate',
  rewrite: '/api/admin/assist/rewrite',
  schemaDraft: '/api/admin/assist/schema/draft',
  contentOpsPropose: '/api/admin/assist/content-ops/propose',
  contentOps: '/api/admin/assist/content-ops',
} as const;

/** Editor assists with the instance's own model provider (documentation/assist.md). */
export const createAssistApi = (request: RequestFn) => ({
  assist: {
    status: () => request<AssistStatus>(ASSIST_PATHS.status),
    altText: (body: AltTextInput) => request<AltTextResult>(ASSIST_PATHS.altText, { method: 'POST', body }),
    summarize: (body: SummarizeInput) =>
      request<AssistTextResult>(ASSIST_PATHS.summarize, { method: 'POST', body }),
    translate: (body: TranslateInput) =>
      request<TranslateResult>(ASSIST_PATHS.translate, { method: 'POST', body }),
    rewrite: (body: RewriteInput) =>
      request<AssistTextResult>(ASSIST_PATHS.rewrite, { method: 'POST', body }),
    schemaDraft: (body: SchemaDraftInput) =>
      request<SchemaDraftResult>(ASSIST_PATHS.schemaDraft, { method: 'POST', body }),
    /** Starts a background run (202); poll it with `contentOpsRun`. */
    proposeContentOps: (body: ContentOpsInput) =>
      request<{ runId: string }>(ASSIST_PATHS.contentOpsPropose, { method: 'POST', body }),
    contentOpsRun: (runId: string) => request<ContentOpsRun>(withId(ASSIST_PATHS.contentOps, runId)),
  },
});
