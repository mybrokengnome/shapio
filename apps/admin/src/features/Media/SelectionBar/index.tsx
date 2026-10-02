import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { MovePopover } from '../MovePopover';

type SelectionBarProps = { selected: ReadonlySet<string>; onClear: () => void };

/** Bulk actions for the ticked assets. Announced when the selection changes. */
export const SelectionBar = ({ selected, onClear }: SelectionBarProps) => {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-accent py-1.5 pr-1.5 pl-4 text-accent-foreground">
      <span role="status" aria-live="polite" className="mr-auto text-sm font-medium">
        {t('media.selectedCount', { count: selected.size })}
      </span>
      <MovePopover assetIds={[...selected]} onMoved={onClear} />
      <Button size="sm" variant="ghost" onClick={onClear}>
        <X aria-hidden="true" />
        {t('media.clearSelection')}
      </Button>
    </div>
  );
};
