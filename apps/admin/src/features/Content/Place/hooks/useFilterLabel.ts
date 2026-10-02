import type { ModelDefinition } from '@shapio/schema';
import { useTranslation } from 'react-i18next';
import { useEntry } from '@/api/content';
import { entryTitle, shortId } from '@/fields/helpers/titles';
import { isValueless, OPERATOR_LABEL_KEYS, type ListFilter } from '../../helpers/filterOperators';
import type { ContentSchema } from '../../hooks/useContentSchema';
import { SYSTEM_LABEL_KEYS } from '../constants';
import { filterFieldOf, isEntryFilter, isSystemField } from '../helpers/filterLabels';

/**
 * A filter row in words, split for the chip: "Title" "starts with" "Co". A relation filter naming one entry
 * shows that entry's title (its short ID until it loads).
 */
export const useFilterLabel = (schema: ContentSchema, model: ModelDefinition, filter: ListFilter) => {
  const { t } = useTranslation();
  const field = filterFieldOf(model, filter);
  const target =
    field?.type === 'relation' && isEntryFilter(field, filter)
      ? schema.models.get(field.settings.target)
      : undefined;
  const entry = useEntry(
    target?.apiKey ?? '',
    filter.value ?? '',
    undefined,
    target !== undefined && Boolean(filter.value),
  );
  const subject = isSystemField(filter.field)
    ? t(SYSTEM_LABEL_KEYS[filter.field])
    : (field?.label ?? filter.field);
  const condition = t(OPERATOR_LABEL_KEYS[filter.operator]);
  const rawValue = isValueless(filter.operator) ? '' : (filter.value ?? '');
  const value =
    target && rawValue
      ? entry.data
        ? (entryTitle(target, entry.data.data) ?? t('content.untitled'))
        : shortId(rawValue)
      : rawValue;
  return { subject, condition, value, text: [subject, condition, value].filter(Boolean).join(' ') };
};
