import { LayoutGrid, Rows3 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import type { ListView } from '../constants';

type ViewToggleProps = { view: ListView; onViewChange: (view: ListView) => void };

/** Table or cover tiles (shown only for models with a cover field). */
export const ViewToggle = ({ view, onViewChange }: ViewToggleProps) => {
  const { t } = useTranslation();
  return (
    <div
      role="group"
      aria-label={t('place.view.label')}
      className="flex h-9 items-center gap-0.5 rounded-lg border border-input px-px"
    >
      <Button
        variant={view === 'table' ? 'secondary' : 'ghost'}
        size="icon-sm"
        aria-pressed={view === 'table'}
        aria-label={t('place.view.table')}
        onClick={() => onViewChange('table')}
      >
        <Rows3 aria-hidden="true" />
      </Button>
      <Button
        variant={view === 'cards' ? 'secondary' : 'ghost'}
        size="icon-sm"
        aria-pressed={view === 'cards'}
        aria-label={t('place.view.cards')}
        onClick={() => onViewChange('cards')}
      >
        <LayoutGrid aria-hidden="true" />
      </Button>
    </div>
  );
};
