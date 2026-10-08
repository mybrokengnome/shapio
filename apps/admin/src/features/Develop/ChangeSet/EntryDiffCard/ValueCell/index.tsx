import type { DataType } from '@shapio/schema';
import { ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { buttonVariants } from '@/components/ui/button';
import { TableCell } from '@/components/ui/table';
import { cn } from '@/helpers/cn';
import { valueText } from '../../helpers/valueText';

/** Types whose stored value reads badly as text: the server's summary is shown, the JSON one click away. */
const STRUCTURED_TYPES: ReadonlySet<DataType> = new Set<DataType>([
  'richtext',
  'media',
  'relation',
  'component',
  'dynamiczone',
  'json',
  'code',
]);

type ValueCellProps = {
  value: unknown;
  /** The server's readable form of `value` (null when empty); used for structured types only. */
  summary: string | null;
  type: DataType;
  side: 'before' | 'after';
};

/**
 * One side of a before/after row: struck through for the old value, "empty" when there is none. Structured
 * values show their summary with a "Raw" disclosure holding the stored JSON; scalars show the value as is.
 */
export const ValueCell = ({ value, summary, type, side }: ValueCellProps) => {
  const { t } = useTranslation();
  const raw = valueText(value);
  const structuredSummary = STRUCTURED_TYPES.has(type) ? summary : null;
  const text = structuredSummary || raw;
  return (
    <TableCell className="max-w-80 align-top whitespace-normal">
      {text ? (
        <span
          className={cn(side === 'before' && 'text-muted-foreground line-through decoration-destructive/60')}
        >
          {text}
        </span>
      ) : (
        <span className="text-meta text-muted-foreground italic">{t('changes.review.empty')}</span>
      )}
      {structuredSummary && raw ? (
        <details className="group mt-1">
          <summary
            className={cn(
              buttonVariants({ variant: 'ghost', size: 'xs' }),
              '-ml-1.5 w-fit cursor-pointer list-none text-muted-foreground [&::-webkit-details-marker]:hidden',
            )}
          >
            <ChevronRight
              aria-hidden="true"
              className="transition-transform group-open:rotate-90 motion-reduce:transition-none"
            />
            {t('changes.review.raw')}
          </summary>
          <pre className="mt-1 font-mono text-meta break-all whitespace-pre-wrap text-muted-foreground">
            {raw}
          </pre>
        </details>
      ) : null}
    </TableCell>
  );
};
