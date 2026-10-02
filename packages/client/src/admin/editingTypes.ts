/**
 * Shapes of the entry document's endpoints (editor experience, E0b): publish pre-flight, content health
 * findings, presence and per-model counts. Sentences are never sent: the admin builds them from `rule` and
 * `params` with its translations.
 */

/** Health rules evaluated per entry (`apps/api/src/services/contentHealth.ts`). */
export const HEALTH_RULES = [
  'requiredEmpty',
  'altMissing',
  'localeMissing',
  'relationMissing',
  'relationUnpublished',
  'uniqueConflict',
  'staleDraft',
  'unpublishedChanges',
] as const;
export type HealthRule = (typeof HEALTH_RULES)[number];

/** Pre-flight adds the publish checks that are not health rules: validator issues and missing media. */
export type PreflightRule = HealthRule | 'invalid' | 'mediaMissing';

export type CheckSeverity = 'error' | 'warning';

/** Values a sentence needs (field ID, asset ID, locale, counts…). */
export type CheckParams = Record<string, string | number | null>;

export type PreflightCheck = {
  rule: PreflightRule;
  /** Errors block publishing; warnings are informational. */
  severity: CheckSeverity;
  /** JSON pointer (API keys) of the value to fix, e.g. `/body` or `/sections/2/title`. */
  path?: string;
  /** The validator's issue code, for `invalid` and `requiredEmpty` errors. */
  code?: string;
  params: CheckParams;
};

export type PreflightLocale = {
  locale: string;
  /** No error-severity check: publishing this locale is expected to succeed. */
  ready: boolean;
  checks: PreflightCheck[];
};

export type PreflightInput = { locales?: string[] };

export type PreflightResponse = {
  locales: PreflightLocale[];
  /** Checks about the entry as a whole, not one locale (e.g. a configured locale not started yet). */
  entry: PreflightCheck[];
};

/** A finding of the health engine, open until its rule passes again. */
export type ContentHealthFinding = {
  id: string;
  entryId: string;
  modelId: string;
  modelKey: string;
  /** The entry's title in the finding's locale (or the default locale), when readable. */
  entryTitle: string | null;
  /** `*` for a finding about the entry as a whole. */
  locale: string;
  rule: HealthRule;
  /** Distinguishes several findings of one rule on one entry (e.g. two images without alt text). */
  subject: string;
  severity: CheckSeverity;
  path?: string;
  params: CheckParams;
  firstSeenAt: string;
  lastSeenAt: string;
};

export type ContentHealthQuery = { rule?: HealthRule; modelKey?: string; cursor?: string; limit?: number };

export type ContentHealthPage = { items: ContentHealthFinding[]; nextCursor: string | null };

export type ContentHealthSummary = { rules: { rule: HealthRule; count: number }[] };

/** Someone with the entry open. */
export type PresencePerson = {
  userId: string;
  name: string;
  /** The locale they are editing, when the model is localized. */
  locale: string | null;
  /** When this tab started editing. */
  since: string;
  /** The caller's own other tab (the calling tab itself is never listed). */
  you: boolean;
};

export type PresenceHeartbeatInput = {
  /** A random ID per browser tab, so two tabs of one person are counted apart. */
  tabId: string;
  locale?: string | null;
};

export type EntryPresence = { people: PresencePerson[] };

export type ModelPresence = { entries: { entryId: string; people: PresencePerson[] }[] };

export type ContentCount = { modelId: string; modelKey: string; total: number };

export type ContentCounts = { counts: ContentCount[] };
