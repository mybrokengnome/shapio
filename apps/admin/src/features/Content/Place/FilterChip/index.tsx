import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';

type FilterChipProps = {
  /** What the chip filters by, e.g. "Title starts with Co". */
  children: ReactNode;
  /** Plain text of the chip for the remove button's name. */
  label: string;
  onRemove: () => void;
};

/** One active filter as a pill with a remove button. */
export const FilterChip = ({ children, label, onRemove }: FilterChipProps) => {
  const { t } = useTranslation();
  return (
    <li className="inline-flex h-7 max-w-full items-center gap-0.5 rounded-full border bg-muted/60 pr-0.5 pl-3 text-xs font-medium">
      <span className="truncate">{children}</span>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={t('place.filters.removeChip', { filter: label })}
        onClick={onRemove}
      >
        <X aria-hidden="true" />
      </Button>
    </li>
  );
};
