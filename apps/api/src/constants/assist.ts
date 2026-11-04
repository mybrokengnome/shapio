/** Editor assists (plan agentic-ecosystem §A0, §I). */
export const ASSIST_ACTIONS = [
  'alt_text',
  'summarize',
  'translate',
  'rewrite',
  'schema_draft',
  'content_ops',
  'write',
  'suggest',
] as const;
export type AssistAction = (typeof ASSIST_ACTIONS)[number];

export const ASSIST_CONTENT_OPS_JOB = 'assist.contentOps';
/** Model calls cost money: a failing content-ops job is retried a little, not ten times. */
export const ASSIST_CONTENT_OPS_MAX_ATTEMPTS = 3;
/** Most findings one content-ops run works through. */
export const ASSIST_CONTENT_OPS_MAX_FINDINGS = 50;
export const CONTENT_OPS_RULES = ['altMissing', 'localeMissing'] as const;
export type ContentOpsRule = (typeof CONTENT_OPS_RULES)[number];

/** Images sent to a vision model are re-encoded as JPEG fitting this box. */
export const ASSIST_IMAGE_MAX_EDGE = 1024;
export const ASSIST_IMAGE_QUALITY = 80;
/** Most bytes of a provider response kept. */
export const ASSIST_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
/** Characters of source text per translate request (long entries are sent in several requests). */
export const ASSIST_TRANSLATE_CHUNK_CHARS = 12_000;
/** Characters of rich text a summary is made from. */
export const ASSIST_SUMMARY_SOURCE_CHARS = 60_000;
/** Characters of a document before and after the point where assist writes (the client sends the nearest). */
export const ASSIST_WRITE_BEFORE_CHARS = 12_000;
export const ASSIST_WRITE_AFTER_CHARS = 2_000;
/** Characters of an entry a suggestion is made from (title, properties, then body), and of one property. */
export const ASSIST_SUGGEST_SOURCE_CHARS = 24_000;
export const ASSIST_SUGGEST_VALUE_CHARS = 2_000;
export const ASSIST_RATE_LIMIT_WINDOW_MS = 60_000;
