import type { FieldDefinition } from '@shapio/schema';
import { useTranslation } from 'react-i18next';
import { useMediaAsset } from '@/api/media';
import { useFieldsEnvironment } from '@/fields/form/context';
import { summarizeValue } from '@/fields/helpers/summary';
import { entryTitle, shortId } from '@/fields/helpers/titles';
import { isEmptyValue, toList } from '@/fields/helpers/values';
import { useEntryLabels } from '@/fields/hooks/useEntryLabels';
import { formatDateTime } from '@/helpers/formatDate';

type PropertyValueProps = { field: FieldDefinition; value: unknown };

const SHOWN_LINKS = 2;

const RelationValue = ({ field, value }: PropertyValueProps) => {
  const { t } = useTranslation();
  const { models, locale } = useFieldsEnvironment();
  const target = field.type === 'relation' ? models.get(field.settings.target) : undefined;
  const ids = toList<string>(value).filter((id): id is string => typeof id === 'string');
  const labels = useEntryLabels(target, ids, locale);
  const names = ids.map((id) => {
    const item = labels.byId.get(id);
    return (
      (target && item ? entryTitle(target, item.data) : undefined) ??
      `${t('content.untitled')} · ${shortId(id)}`
    );
  });
  const shown = names.slice(0, SHOWN_LINKS).join(', ');
  return (
    <>
      {names.length > SHOWN_LINKS
        ? t('entry.properties.andMore', { list: shown, count: names.length - SHOWN_LINKS })
        : shown}
    </>
  );
};

const MediaValue = ({ value }: { value: unknown }) => {
  const ids = toList<string>(value).filter((id): id is string => typeof id === 'string');
  const first = useMediaAsset(ids[0]);
  const name = first.data?.filename ?? '';
  return <>{ids.length > 1 ? `${name} +${ids.length - 1}` : name}</>;
};

/**
 * A property's value as one short line (strip chips, drawer rows): titles of linked entries, file names,
 * dates in the viewer's time, choice labels, Yes/No. Empty shows a muted "Empty".
 */
export const PropertyValue = ({ field, value }: PropertyValueProps) => {
  const { t } = useTranslation();
  if (isEmptyValue(value)) {
    return <span className="text-muted-foreground">{t('entry.properties.empty')}</span>;
  }
  switch (field.type) {
    case 'relation':
      return <RelationValue field={field} value={value} />;
    case 'media':
      return <MediaValue value={value} />;
    case 'boolean':
      return <>{value === true ? t('content.fields.yes') : t('content.fields.no')}</>;
    case 'datetime':
      return <>{typeof value === 'string' ? formatDateTime(value) : ''}</>;
    case 'component':
    case 'dynamiczone':
      return <>{t('entry.properties.items', { count: toList(value).length })}</>;
    default:
      return <>{summarizeValue(field, value)}</>;
  }
};
