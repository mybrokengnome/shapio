import type { SchemaDefinition } from '@shapio/schema';

/** Editor assists (plan agentic-ecosystem §A0). Agents propose, people ship: nothing here publishes. */
export type AssistProvider = 'anthropic' | 'openai' | 'openai-compatible';

export type AssistUsage = { month: string; runs: number; inputTokens: number; outputTokens: number };

/** `usage` only for admins with `changes.manage`; provider and model only while assist is on. */
export type AssistStatus = {
  enabled: boolean;
  provider?: AssistProvider;
  model?: string;
  usage?: AssistUsage;
};

export type AltTextInput = { assetId: string; locale?: string };
export type AltTextResult = { alt: string; model: string };

/** A model-written text; `truncated` when it was cut to the field's or the request's limit. */
export type AssistTextResult = { text: string; truncated: boolean; model: string };

export type SummarizeInput = { modelKey: string; entryId: string; locale?: string; fieldApiKey: string };

export type TranslateInput = { modelKey: string; entryId: string; from: string; to: string };
export type AssistIssue = { path: string; code: string; message: string };
/** `data` is in the editor's save format: save it as the `to` locale's draft. */
export type TranslateResult = { data: Record<string, unknown>; issues: AssistIssue[]; model: string };

export type RewriteInput = { text: string; instruction: string; maxLength?: number };

export type SchemaDraftInput = { description: string };
/** New definitions with new stable IDs, in save order (references first). Nothing is written. */
export type SchemaDraftResult = { definitions: SchemaDefinition[]; model: string };

export const CONTENT_OPS_RULES = ['altMissing', 'localeMissing'] as const;
export type ContentOpsRule = (typeof CONTENT_OPS_RULES)[number];
export type ContentOpsInput = { rule: ContentOpsRule; modelKey?: string; fromLocale?: string };
export type ContentOpsStatus = 'queued' | 'running' | 'succeeded' | 'failed';

/** One library asset's proposed alt text; apply it with the media update at `assetVersion`. */
export type AltProposal = {
  assetId: string;
  filename: string;
  currentAlt: string | null;
  proposedAlt: string;
  assetVersion: number;
  findingCount: number;
};

/** A finding the run left alone, and why (an error code or a reason such as `publishesOnSave`). */
export type ContentOpsSkip = {
  key: string;
  entryId?: string;
  assetId?: string;
  locale?: string;
  reason: string;
  detail?: unknown;
};
export type ContentOpsWritten = { entryId: string; modelKey: string; locale: string; version: number };

export type AltMissingResult = { rule: 'altMissing'; proposals: AltProposal[]; skipped: ContentOpsSkip[] };
/** The drafts were written into the change set `changeSetId` (null when nothing was written). */
export type LocaleMissingResult = {
  rule: 'localeMissing';
  changeSetId: string | null;
  fromLocale: string;
  written: ContentOpsWritten[];
  skipped: ContentOpsSkip[];
};
export type ContentOpsResult = AltMissingResult | LocaleMissingResult;

export type ContentOpsRun = {
  runId: string;
  rule: ContentOpsRule;
  status: ContentOpsStatus;
  model: string;
  createdAt: string;
  finishedAt: string | null;
  error: { code: string } | null;
  /** Once succeeded (null before, or partial progress while running). */
  result: ContentOpsResult | null;
};
