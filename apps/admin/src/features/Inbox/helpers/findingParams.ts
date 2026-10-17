import type { ContentHealthFinding, HealthRule } from '@shapio/client';
import type { ModelDefinition } from '@shapio/schema';
import { RULE_SENTENCE_KEYS, RULE_TARGET_SENTENCE_KEYS } from '../constants';

/** The label of the top-level field a JSON pointer (API keys) starts with: `/sections/2/title` → "Sections". */
export const fieldLabelOf = (
  model: ModelDefinition | undefined,
  path: string | undefined,
): string | undefined => {
  const apiKey = path?.split('/')[1];
  if (!model || !apiKey) {
    return undefined;
  }
  return model.fields.find((field) => field.apiKey === decodeURIComponent(apiKey))?.label;
};

type SentenceParams = { field: string; locale: string; count: number; target: string };

/**
 * The values a finding's sentence needs: the field's label (or "a field"), the locale's name, and a day
 * count for the staleness rules.
 */
export const findingParams = (
  finding: Pick<ContentHealthFinding, 'path' | 'locale' | 'params' | 'targetTitle'>,
  model: ModelDefinition | undefined,
  localeLabel: (code: string) => string,
  fallbackField: string,
): SentenceParams => {
  const locale = typeof finding.params.locale === 'string' ? finding.params.locale : finding.locale;
  return {
    field: fieldLabelOf(model, finding.path) ?? fallbackField,
    locale: locale === '*' ? '' : localeLabel(locale),
    count: typeof finding.params.days === 'number' ? finding.params.days : 0,
    target: finding.targetTitle ?? '',
  };
};

/** The sentence for a finding: the one naming the linked entry when its title is known, else the rule's. */
type SentenceKey =
  | (typeof RULE_SENTENCE_KEYS)[keyof typeof RULE_SENTENCE_KEYS]
  | (typeof RULE_TARGET_SENTENCE_KEYS)[keyof typeof RULE_TARGET_SENTENCE_KEYS];

const TARGET_SENTENCE_KEYS: Partial<Record<HealthRule, SentenceKey>> = RULE_TARGET_SENTENCE_KEYS;

export const sentenceKeyOf = (finding: Pick<ContentHealthFinding, 'rule' | 'targetTitle'>): SentenceKey => {
  const named = TARGET_SENTENCE_KEYS[finding.rule];
  return named && finding.targetTitle ? named : RULE_SENTENCE_KEYS[finding.rule];
};

/** The linked entry a relation finding is about (`?target=` on its link), if any. */
export const linkedEntryOf = (finding: Pick<ContentHealthFinding, 'params'>): string | undefined =>
  typeof finding.params.targetEntryId === 'string' ? finding.params.targetEntryId : undefined;
