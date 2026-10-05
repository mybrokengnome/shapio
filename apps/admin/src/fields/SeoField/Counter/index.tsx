import { useTranslation } from 'react-i18next';
import { cn } from '@/helpers/cn';
import type { SeoCounter } from '../helpers';

type CounterProps = { counter: SeoCounter };

/** Characters used against the soft maximum, shown near and over it. Never an error: nothing is enforced. */
export const Counter = ({ counter }: CounterProps) => {
  const { t } = useTranslation();
  return (
    <p className={cn('text-meta tabular-nums', counter.over ? 'text-warning' : 'text-muted-foreground')}>
      {t(counter.over ? 'seo.field.counterOver' : 'seo.field.counter', {
        count: counter.count,
        max: counter.max,
      })}
    </p>
  );
};
