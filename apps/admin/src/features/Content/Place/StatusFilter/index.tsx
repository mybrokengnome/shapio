import type { EntryStatus } from '@shapio/client';
import { useTranslation } from 'react-i18next';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ENTRY_STATUS_LABEL_KEYS } from '../../helpers/entryStatus';
import { AddChip } from '../AddChip';
import { ENTRY_STATUSES } from '../constants';

type StatusFilterProps = { onPick: (status: EntryStatus) => void };

/** "+ Status": only drafts, changed or published entries (in the list's locale). */
export const StatusFilter = ({ onPick }: StatusFilterProps) => {
  const { t } = useTranslation();
  return (
    <li>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <AddChip>{t('place.filters.status')}</AddChip>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {ENTRY_STATUSES.map((status) => (
            <DropdownMenuItem key={status} onSelect={() => onPick(status)}>
              {t(ENTRY_STATUS_LABEL_KEYS[status])}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
};
