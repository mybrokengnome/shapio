import { useTranslation } from 'react-i18next';
import { TableCell } from '@/components/ui/table';
import { valueText } from '../../helpers/valueText';

type ValueCellProps = { value: unknown; side: 'before' | 'after' };

/** One side of a before/after row: struck through for the old value, "empty" when there is none. */
export const ValueCell = ({ value, side }: ValueCellProps) => {
  const { t } = useTranslation();
  const text = valueText(value);
  return (
    <TableCell className="max-w-80 align-top whitespace-normal">
      {text ? (
        <span
          className={side === 'before' ? 'text-muted-foreground line-through decoration-destructive/60' : ''}
        >
          {text}
        </span>
      ) : (
        <span className="text-meta text-muted-foreground italic">{t('changes.review.empty')}</span>
      )}
    </TableCell>
  );
};
