import type { ReactNode } from 'react';
import { cn } from '@/helpers/cn';
import { FOLDER_ROW_CLASSES } from '../constants';

type ScopeButtonProps = { current: boolean; icon: ReactNode; label: string; onClick: () => void };

/** "All media" and "Not in a folder": scopes above the folder list. */
export const ScopeButton = ({ current, icon, label, onClick }: ScopeButtonProps) => (
  <button
    type="button"
    aria-current={current ? 'true' : undefined}
    onClick={onClick}
    className={cn(FOLDER_ROW_CLASSES, 'w-full px-2.5')}
  >
    {icon}
    <span className="truncate">{label}</span>
  </button>
);
