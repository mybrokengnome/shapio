import type { RequestFn } from '../request.js';
import type {
  AcceptContentOpsInput,
  AcceptContentOpsResult,
  AltTextInput,
  AltTextResult,
  AssistStatus,
  AssistTextResult,
  ContentOpsInput,
  ContentOpsRun,
  RewriteInput,
  SchemaDraftInput,
  SchemaDraftResult,
  SuggestInput,
  SuggestResult,
  SummarizeInput,
  TranslateInput,
  TranslateResult,
  WriteInput,
  WriteResult,
} from './assistTypes.js';
import { withId } from './paths.js';

export const ASSIST_PATHS = {
  status: '/api/admin/assist/status',
  altText: '/api/admin/assist/alt-text',
  summarize: '/api/admin/assist/summarize',
  translate: '/api/admin/assist/translate',
  rewrite: '/api/admin/assist/rewrite',
  write: '/api/admin/assist/write',
  suggest: '/api/admin/assist/suggest',
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
    write: (body: WriteInput) => request<WriteResult>(ASSIST_PATHS.write, { method: 'POST', body }),
    suggest: (body: SuggestInput) => request<SuggestResult>(ASSIST_PATHS.suggest, { method: 'POST', body }),
    schemaDraft: (body: SchemaDraftInput) =>
      request<SchemaDraftResult>(ASSIST_PATHS.schemaDraft, { method: 'POST', body }),
    /** Starts a background run (202); poll it with `contentOpsRun`. */
    proposeContentOps: (body: ContentOpsInput) =>
      request<{ runId: string }>(ASSIST_PATHS.contentOpsPropose, { method: 'POST', body }),
    contentOpsRun: (runId: string) => request<ContentOpsRun>(withId(ASSIST_PATHS.contentOps, runId)),
    /** Saves proposals of a fill run (`requiredEmpty`, `fieldEmpty`) into one entry locale's draft. */
    acceptContentOps: (runId: string, body: AcceptContentOpsInput) =>
      request<AcceptContentOpsResult>(`${withId(ASSIST_PATHS.contentOps, runId)}/accept`, {
        method: 'POST',
        body,
      }),
  },
});
