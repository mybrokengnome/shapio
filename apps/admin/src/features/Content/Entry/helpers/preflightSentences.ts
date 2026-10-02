import type { ContentIssue, PreflightCheck, PreflightRule } from '@shapio/client';
import type { FieldDefinition } from '@shapio/schema';
import { describeIssue } from '@/fields/helpers/issues';

/** One sentence per rule (`entry.preflight.rules.*`), built from the check's params by the admin. */
export const PREFLIGHT_RULE_KEYS = {
  requiredEmpty: 'entry.preflight.rules.requiredEmpty',
  invalid: 'entry.preflight.rules.invalid',
  mediaMissing: 'entry.preflight.rules.mediaMissing',
  altMissing: 'entry.preflight.rules.altMissing',
  localeMissing: 'entry.preflight.rules.localeMissing',
  relationMissing: 'entry.preflight.rules.relationMissing',
  relationUnpublished: 'entry.preflight.rules.relationUnpublished',
  uniqueConflict: 'entry.preflight.rules.uniqueConflict',
  staleDraft: 'entry.preflight.rules.staleDraft',
  unpublishedChanges: 'entry.preflight.rules.unpublishedChanges',
} as const satisfies Record<PreflightRule, string>;

/** A locale not started yet, as a whole-entry warning ("French hasn't been started"). */
export const ENTRY_LOCALE_MISSING_KEY = 'entry.preflight.rules.localeNotStarted';

export type SentenceParts = {
  key: (typeof PREFLIGHT_RULE_KEYS)[PreflightRule] | typeof ENTRY_LOCALE_MISSING_KEY;
  values: Record<string, string | number>;
};

type SentenceContext = {
  /** The readable trail of the check's path ("Sections › 2 › Title"), when it has one. */
  fieldLabel: string | undefined;
  /** The field at the end of the path, for the validator's message. */
  field: FieldDefinition | undefined;
  localeLabel: (code: string) => string;
  /** Whole-entry checks (other locales) read differently from this locale's. */
  entryLevel: boolean;
};

const param = (check: PreflightCheck, name: string) => {
  const value = check.params[name];
  return typeof value === 'string' || typeof value === 'number' ? value : '';
};

/** The translation key and values that turn a check into a plain sentence. */
export const sentenceOf = (check: PreflightCheck, context: SentenceContext): SentenceParts => {
  const field = context.fieldLabel ?? '';
  if (check.rule === 'localeMissing') {
    const locale = context.localeLabel(String(param(check, 'locale')));
    return context.entryLevel
      ? { key: ENTRY_LOCALE_MISSING_KEY, values: { locale } }
      : { key: PREFLIGHT_RULE_KEYS.localeMissing, values: { locale } };
  }
  if (check.rule === 'invalid') {
    const issue: ContentIssue = { path: check.path ?? '', code: check.code ?? '', message: '' };
    return {
      key: PREFLIGHT_RULE_KEYS.invalid,
      values: { field, problem: describeIssue(issue, context.field) },
    };
  }
  if (check.rule === 'staleDraft' || check.rule === 'unpublishedChanges') {
    return {
      key: PREFLIGHT_RULE_KEYS[check.rule],
      values: { days: param(check, 'days'), count: Number(param(check, 'days')) },
    };
  }
  return { key: PREFLIGHT_RULE_KEYS[check.rule], values: { field } };
};
