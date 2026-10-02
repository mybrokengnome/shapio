import type { ContentHealthFinding } from '@shapio/client';
import type { ModelDefinition } from '@shapio/schema';

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

type SentenceParams = { field: string; locale: string; count: number };

/**
 * The values a finding's sentence needs: the field's label (or "a field"), the locale's name, and a day
 * count for the staleness rules.
 */
export const findingParams = (
  finding: Pick<ContentHealthFinding, 'path' | 'locale' | 'params'>,
  model: ModelDefinition | undefined,
  localeLabel: (code: string) => string,
  fallbackField: string,
): SentenceParams => {
  const locale = typeof finding.params.locale === 'string' ? finding.params.locale : finding.locale;
  return {
    field: fieldLabelOf(model, finding.path) ?? fallbackField,
    locale: locale === '*' ? '' : localeLabel(locale),
    count: typeof finding.params.days === 'number' ? finding.params.days : 0,
  };
};
