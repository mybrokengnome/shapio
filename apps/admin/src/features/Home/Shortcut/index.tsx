import { Link, type LinkOptions } from '@tanstack/react-router';
import { ChevronRight, type LucideIcon } from 'lucide-react';
import { IconTile } from '@/components/IconTile';

type ShortcutProps = { label: string; icon: LucideIcon; link: LinkOptions };

/** One row of the Shortcuts panel. */
export const Shortcut = ({ label, icon, link }: ShortcutProps) => (
  <Link
    {...link}
    className="group flex items-center gap-3 rounded-lg px-2 py-1.5 text-sm font-semibold outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50"
  >
    <IconTile icon={icon} size="sm" />
    <span className="flex-1">{label}</span>
    <ChevronRight
      aria-hidden="true"
      className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5"
    />
  </Link>
);
