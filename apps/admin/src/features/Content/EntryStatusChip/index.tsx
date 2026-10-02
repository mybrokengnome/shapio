import type { EntryStatus } from '@shapio/client';
import { useTranslation } from 'react-i18next';
import { StatusChip } from '@/components/StatusChip';
import { ENTRY_STATUS_LABEL_KEYS, ENTRY_STATUS_TONES } from '../helpers/entryStatus';

type EntryStatusChipProps = { status: EntryStatus; size?: 'default' | 'sm'; className?: string };

/** Draft, published, or published with newer draft changes ("Changed"). */
export const EntryStatusChip = ({ status, size, className }: EntryStatusChipProps) => {
  const { t } = useTranslation();
  return (
    <StatusChip
      tone={ENTRY_STATUS_TONES[status]}
      label={t(ENTRY_STATUS_LABEL_KEYS[status])}
      size={size}
      className={className}
    />
  );
};
