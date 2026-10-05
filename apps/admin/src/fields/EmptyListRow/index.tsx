import { Boxes } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/components/EmptyState';
import { emptyListMinimum } from '../helpers/listLimits';

type EmptyListRowProps = {
  /** The list's `min`: named only when one item would not be enough. */
  min: number | undefined;
  /** How to add the first item (none when read-only or full). */
  action: ReactNode;
};

/** An empty list of the entry canvas: "Nothing added yet." in a dashed row, with its add control. */
export const EmptyListRow = ({ min, action }: EmptyListRowProps) => {
  const { t } = useTranslation();
  const minimum = emptyListMinimum(min);
  return (
    <EmptyState
      compact
      icon={Boxes}
      title={t('content.items.empty')}
      description={minimum === undefined ? undefined : t('content.issues.tooFew', { count: minimum })}
      action={action}
      className="rounded-xl border border-dashed px-4"
    />
  );
};
