import { CornerDownLeft } from 'lucide-react';
import { cn } from '@/helpers/cn';
import type { PaletteItem } from '../types';

type OptionProps = {
  id: string;
  item: PaletteItem;
  active: boolean;
  onHover: () => void;
  onSelect: () => void;
};

/**
 * One result row (`role="option"`). Focus stays in the search input; the active row is announced through
 * `aria-activedescendant`, highlighted with the selection colour and shows the Enter hint.
 */
export const Option = ({ id, item, active, onHover, onSelect }: OptionProps) => {
  const Icon = item.icon;
  return (
    <li
      id={id}
      role="option"
      aria-selected={active}
      data-active={active}
      onPointerMove={onHover}
      // Keep focus in the input when a row is clicked.
      onPointerDown={(event) => event.preventDefault()}
      onClick={onSelect}
      className={cn(
        'flex h-10 cursor-pointer items-center gap-3 rounded-lg px-2 text-sm select-none',
        active && 'bg-accent text-accent-foreground',
      )}
    >
      {Icon ? <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" /> : null}
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {item.hint ? (
        <span className="shrink-0 truncate text-meta text-muted-foreground">{item.hint}</span>
      ) : null}
      <CornerDownLeft
        aria-hidden="true"
        className={cn('size-3.5 shrink-0 text-muted-foreground', active ? 'opacity-100' : 'opacity-0')}
      />
    </li>
  );
};
