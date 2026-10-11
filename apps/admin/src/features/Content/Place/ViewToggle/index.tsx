import { LayoutGrid, Rows3 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SegmentedToggle } from '@/components/SegmentedToggle';
import type { ListView } from '../constants';

type ViewToggleProps = { view: ListView; onViewChange: (view: ListView) => void };

/** Table or cover tiles (shown only for models with a cover field). */
export const ViewToggle = ({ view, onViewChange }: ViewToggleProps) => {
  const { t } = useTranslation();
  return (
    <SegmentedToggle
      aria-label={t('place.view.label')}
      iconOnly
      value={view}
      onChange={onViewChange}
      options={[
        { value: 'table', label: t('place.view.table'), icon: Rows3 },
        { value: 'cards', label: t('place.view.cards'), icon: LayoutGrid },
      ]}
    />
  );
};
