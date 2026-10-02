import type { FieldDefinition } from '@shapio/schema';
import { useTranslation } from 'react-i18next';
import { summarizeValue } from '@/fields/helpers/summary';
import { isEmptyValue, toList } from '@/fields/helpers/values';
import { formatDateTime } from '@/helpers/formatDate';

type CellProps = { field: FieldDefinition; value: unknown };

/** One field's value in the list, as short readable text (counts for lists, Yes/No for booleans). */
export const Cell = ({ field, value }: CellProps) => {
  const { t } = useTranslation();
  if (isEmptyValue(value)) {
    return <span className="text-muted-foreground">{t('place.list.emptyValue')}</span>;
  }
  switch (field.type) {
    case 'boolean':
      return <>{value === true ? t('content.fields.yes') : t('content.fields.no')}</>;
    case 'datetime':
      return <>{formatDateTime(typeof value === 'string' ? value : null)}</>;
    case 'media':
    case 'relation':
    case 'component':
    case 'dynamiczone':
      return <>{t('place.list.itemCount', { count: toList(value).length })}</>;
    default:
      return <span className="line-clamp-2">{summarizeValue(field, value)}</span>;
  }
};
