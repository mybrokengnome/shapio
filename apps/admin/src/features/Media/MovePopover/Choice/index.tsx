import { Loader2 } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import { cn } from '@/helpers/cn';
import { FOLDER_ROW_CLASSES } from '../../FolderTree/constants';

type ChoiceProps = {
  icon: ReactNode;
  label: string;
  /** Nesting level, indents the row (a runtime value, passed as a CSS variable). */
  depth: number;
  pending: boolean;
  disabled: boolean;
  onClick: () => void;
};

/** One folder in the move popover, indented by its depth; a spinner while the move into it runs. */
export const Choice = ({ icon, label, depth, pending, disabled, onClick }: ChoiceProps) => (
  <li>
    <button
      type="button"
      disabled={disabled}
      aria-busy={pending || undefined}
      onClick={onClick}
      style={{ '--depth': depth } as CSSProperties}
      className={cn(
        FOLDER_ROW_CLASSES,
        'w-full pr-2.5 pl-[calc(0.625rem+var(--depth)*1rem)] disabled:opacity-50',
      )}
    >
      {pending ? <Loader2 aria-hidden="true" className="animate-spin" /> : icon}
      <span className="truncate">{label}</span>
    </button>
  </li>
);
