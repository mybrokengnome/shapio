import { Link, type LinkProps } from '@tanstack/react-router';
import { ArrowRight, type LucideIcon } from 'lucide-react';
import { IconTile } from '@/components/IconTile';

type NextStepProps = { to: LinkProps['to']; icon: LucideIcon; title: string; description: string };

/** A setup card: shown on Home only while the step still needs doing. */
export const NextStep = ({ to, icon, title, description }: NextStepProps) => (
  <Link
    to={to}
    className="group flex items-start gap-4 rounded-xl border bg-card p-5 text-card-foreground transition-colors outline-none hover:border-primary/40 hover:bg-muted/40 focus-visible:ring-[3px] focus-visible:ring-ring/50"
  >
    <IconTile icon={icon} size="lg" />
    <span className="min-w-0 flex-1 space-y-1">
      <span className="flex items-center gap-1 font-semibold">
        {title}
        <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
      </span>
      <span className="block text-meta text-muted-foreground">{description}</span>
    </span>
  </Link>
);
