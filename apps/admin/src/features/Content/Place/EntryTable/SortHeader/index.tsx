import type { ContentSort } from '@shapio/client';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/helpers/cn';

type SortHeaderProps = {
  label: string;
  field: string;
  sort: ContentSort | undefined;
  onSortChange: (sort: ContentSort) => void;
};

/** A column label that sorts by its column (keeps the header's 12px uppercase style). */
export const SortHeader = ({ label, field, sort, onSortChange }: SortHeaderProps) => {
  const { t } = useTranslation();
  const active = sort?.field === field ? sort.direction : undefined;
  const Icon = active === 'asc' ? ArrowUp : active === 'desc' ? ArrowDown : ArrowUpDown;
  return (
    <button
      type="button"
      aria-label={t('place.list.sortBy', { field: label })}
      className={cn(
        '-ml-1.5 inline-flex h-7 items-center gap-1 rounded-md px-1.5 tracking-wide uppercase outline-none hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50',
        active && 'text-foreground',
      )}
      onClick={() => onSortChange({ field, direction: active === 'asc' ? 'desc' : 'asc' })}
    >
      {label}
      <Icon aria-hidden="true" className={cn('size-3.5', !active && 'opacity-50')} />
    </button>
  );
};
