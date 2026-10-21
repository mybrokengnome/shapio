import type { ModelDefinition } from '@shapio/schema';
import { useTranslation } from 'react-i18next';
import { relationTargetInfoOf, type RelationTargetInfo } from '@/fields/helpers/relationTargetLabel';
import { shortId } from '@/fields/helpers/titles';
import { useEntryLabels } from '@/fields/hooks/useEntryLabels';
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
  const target: RelationTargetInfo =
    field?.type === 'relation' && isEntryFilter(field, filter)
      ? relationTargetInfoOf(field.settings.target, schema.models, schema.index)
      : { kind: 'unreadable' };
  const entryId = target.kind !== 'unreadable' && filter.value ? filter.value : undefined;
  const labels = useEntryLabels(target, field?.id ?? '', entryId ? [entryId] : [], null);
  const entry = entryId ? labels.byId.get(entryId) : undefined;
  const subject = isSystemField(filter.field)
    ? t(SYSTEM_LABEL_KEYS[filter.field])
    : (field?.label ?? filter.field);
  const condition = t(OPERATOR_LABEL_KEYS[filter.operator]);
  const rawValue = isValueless(filter.operator) ? '' : (filter.value ?? '');
  const value =
    entryId && rawValue ? (entry ? (entry.title ?? t('content.untitled')) : shortId(rawValue)) : rawValue;
  return { subject, condition, value, text: [subject, condition, value].filter(Boolean).join(' ') };
};
