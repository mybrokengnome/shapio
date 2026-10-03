import type { ContentOpsStatus } from '@shapio/client';

/** Turning assist on and choosing a provider (env only, by design: no key entry in the admin). */
export const ASSIST_DOCS_URL = 'https://github.com/mybrokengnome/shapio/blob/main/documentation/assist.md';

/** The status changes only with a restart, so it is read once in a while, not on every screen. */
export const ASSIST_STATUS_STALE_MS = 5 * 60_000;

/** How often a content-ops run is re-read while it is queued or running. */
export const CONTENT_OPS_POLL_MS = 1500;

export const CONTENT_OPS_FINISHED: readonly ContentOpsStatus[] = ['succeeded', 'failed'];

/** The server's limits on a rewrite (routes/admin/assist/schemas.ts). */
export const REWRITE_MAX_TEXT = 20_000;
export const REWRITE_MAX_INSTRUCTION = 500;

/** A schema description's limit (routes/admin/assist/schemas.ts). */
export const SCHEMA_DESCRIPTION_MAX = 4000;

/**
 * One-click rewrite instructions (sent to the model as written; the buttons' labels are translated). The
 * model answers in the language of the text, whatever the instruction's language.
 */
export const REWRITE_PRESETS = {
  shorten: 'Make it shorter and tighter, keeping the meaning and the tone.',
  expand: 'Expand it with a little more detail, keeping the meaning and the tone.',
} as const;
