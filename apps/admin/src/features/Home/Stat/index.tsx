import { Link, type LinkOptions } from '@tanstack/react-router';
import type { LucideIcon } from 'lucide-react';
import { IconTile } from '@/components/IconTile';

type StatProps = {
  label: string;
  /** Undefined while loading. */
  value: number | undefined;
  icon: LucideIcon;
  link: LinkOptions;
};

/** A slim dashboard number (one line, about 68px) that links to the screen behind it. */
export const Stat = ({ label, value, icon, link }: StatProps) => (
  <Link
    {...link}
    className="flex items-center gap-3 rounded-xl border bg-card px-4 py-4 text-card-foreground transition-colors outline-none hover:border-primary/40 hover:bg-muted/40 focus-visible:ring-[3px] focus-visible:ring-ring/50"
  >
    <IconTile icon={icon} size="md" />
    <span className="min-w-0 flex-1 truncate text-sm font-medium text-muted-foreground">{label}</span>
    <span className="text-xl leading-7 font-bold tabular-nums">{value ?? '–'}</span>
  </Link>
);
