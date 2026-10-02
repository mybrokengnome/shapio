import type { LucideIcon } from 'lucide-react';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';

type InsertMenuItemProps = {
  icon: LucideIcon;
  label: string;
  /** One short line under the label ("from the library or drop a file"). */
  hint?: string;
  disabled?: boolean;
  onSelect: () => void;
};

/** One entry of a `+` menu in the entry document: an icon tile, the block's name and an optional hint. */
export const InsertMenuItem = ({ icon: Icon, label, hint, disabled, onSelect }: InsertMenuItemProps) => (
  <DropdownMenuItem disabled={disabled} onSelect={onSelect} className="gap-3 py-1.5">
    <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground [&_svg]:size-4">
      <Icon aria-hidden="true" />
    </span>
    <span className="min-w-0">
      <span className="block">{label}</span>
      {hint ? <span className="block text-meta text-muted-foreground">{hint}</span> : null}
    </span>
  </DropdownMenuItem>
);
