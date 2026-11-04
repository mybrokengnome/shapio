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

/**
 * Text written into a rich-text document at the editor's cursor. The caller sends the context: `before` is the
 * text up to the insertion point (its last 12,000 characters), `after` what follows it (up to 2,000).
 * `section` needs an instruction; `continue` takes one as an optional steer.
 */
type WriteContext = {
  before: string;
  after?: string;
  title?: string;
  fieldLabel?: string;
  locale?: string;
};
export type WriteInput =
  | (WriteContext & { kind: 'section'; instruction: string })
  | (WriteContext & { kind: 'continue'; instruction?: string });
/** Markdown (headings, paragraphs, lists, quotes, bold, italic, inline code) for the editor to review. */
export type WriteResult = { markdown: string; model: string };

/** `fieldPath` is a JSON pointer in API IDs: a top-level field (`/keywords`) or a single component's field (`/seo/title`). */
export type SuggestInput = { modelKey: string; entryId: string; locale?: string; fieldPath: string };
/** A string, or for an enum the stored value (a string, or a list of strings when it allows several). */
export type SuggestedValue = string | string[];
export type SuggestResult = { value: SuggestedValue; truncated: boolean; model: string };

export type SchemaDraftInput = { description: string };
/** New definitions with new stable IDs, in save order (references first). Nothing is written. */
export type SchemaDraftResult = { definitions: SchemaDefinition[]; model: string };

export const CONTENT_OPS_RULES = ['altMissing', 'localeMissing', 'requiredEmpty', 'fieldEmpty'] as const;
export type ContentOpsRule = (typeof CONTENT_OPS_RULES)[number];
/**
 * `modelKey` narrows `altMissing`, `localeMissing` and `requiredEmpty` to one content type and is required for
 * `fieldEmpty`, with `fieldPath` (JSON pointer in API IDs) and an optional `locale` (default: the default
 * locale). `fromLocale` is the source of `localeMissing` translations.
 */
export type ContentOpsInput = {
  rule: ContentOpsRule;
  modelKey?: string;
  fromLocale?: string;
  fieldPath?: string;
  locale?: string;
};
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
export type FillFieldType = 'string' | 'text' | 'enum';

/**
 * A proposed value for an empty field of an entry's draft (`requiredEmpty`, `fieldEmpty`). Nothing is written
 * until it is accepted. `options` and `multiple` describe an enum; `maxLength` a string or text.
 */
export type FieldProposal = {
  /** `entry:{entryId}:{locale}:{fieldPath}`; accept by this key. */
  key: string;
  entryId: string;
  modelKey: string;
  entryTitle: string | null;
  locale: string;
  fieldPath: string;
  fieldLabel: string;
  fieldType: FillFieldType;
  proposedValue: SuggestedValue;
  /** The draft version the value was proposed from (informational: accept guards the field, not the version). */
  entryVersion: number;
  maxLength?: number;
  multiple?: boolean;
  options?: { value: string; label: string }[];
};

/** `scanCapped`: a component field's fill stopped after reading 2,000 entries; run it again for more. */
export type FieldFillResult = {
  rule: 'requiredEmpty' | 'fieldEmpty';
  proposals: FieldProposal[];
  skipped: ContentOpsSkip[];
  scanCapped: boolean;
};

export type ContentOpsResult = AltMissingResult | LocaleMissingResult | FieldFillResult;

/** The proposals to accept, all of one entry and locale, with the values to save (edited or as proposed). */
export type AcceptContentOpsInput = { items: { key: string; value: SuggestedValue }[] };

/**
 * The values were saved into the entry's draft. The entry locale is in the run's change set when `added`; it is
 * left out when its draft held unpublished changes before the accept, or was never published, so shipping the
 * set never publishes more than the fill.
 */
export type AcceptContentOpsResult = {
  entryId: string;
  modelKey: string;
  locale: string;
  version: number;
  changeSet:
    | { added: true; id: string }
    | { added: false; id: string | null; reason: 'unpublishedChanges' | 'neverPublished' };
};

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
