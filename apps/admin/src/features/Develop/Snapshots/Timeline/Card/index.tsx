import { History, ImageOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { StatusChip, type StatusTone } from '@/components/StatusChip';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/helpers/cn';
import type { CardMark, TimelineCard } from '../helpers/cards';

const MARK_DISPLAY = {
  unchanged: { labelKey: 'snapshots.timeline.marks.unchanged', tone: 'success' },
  added: { labelKey: 'snapshots.timeline.marks.added', tone: 'success' },
  changed: { labelKey: 'snapshots.timeline.marks.changed', tone: 'warning' },
  removed: { labelKey: 'snapshots.timeline.marks.removed', tone: 'muted' },
} as const satisfies Record<CardMark, { labelKey: string; tone: StatusTone }>;

/** Appear, pulse once, or fade: replayed whenever the card is re-keyed for a new snapshot. No motion when reduced. */
const MARK_CLASSES = {
  unchanged: '',
  added: 'animate-in fade-in zoom-in-95 duration-500',
  changed: 'ring-2 ring-warning animate-in zoom-in-95 duration-500',
  removed: 'border-dashed bg-muted/40 animate-in fade-in duration-500',
} as const satisfies Record<CardMark, string>;

type CardProps = { card: TimelineCard; onOpen: (card: TimelineCard) => void };

/** One entry as it was at the snapshot: cover, title, live locales, what happened to it, and its version. */
export const Card = ({ card, onOpen }: CardProps) => {
  const { t } = useTranslation();
  const display = MARK_DISPLAY[card.mark];
  const title = card.title ?? t('snapshots.timeline.untitled');
  return (
    <li
      data-mark={card.mark}
      aria-label={t('snapshots.timeline.cardLabel', { title, state: t(display.labelKey) })}
      className={cn(
        'flex min-w-0 flex-col overflow-hidden rounded-xl border bg-card motion-reduce:animate-none',
        MARK_CLASSES[card.mark],
      )}
    >
      <div
        className={cn(
          'flex aspect-video items-center justify-center bg-muted transition-opacity duration-500 motion-reduce:transition-none',
          card.mark === 'removed' && 'opacity-40 grayscale',
        )}
      >
        {card.coverUrl ? (
          <img src={card.coverUrl} alt="" loading="lazy" className="size-full object-cover" />
        ) : (
          <ImageOff aria-hidden="true" className="size-5 text-muted-foreground" />
        )}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-3">
        <p className={cn('line-clamp-2 text-sm font-semibold', card.mark === 'removed' && 'line-through')}>
          {title}
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusChip tone={display.tone} label={t(display.labelKey)} size="sm" live={false} />
          {card.locales.map((locale) => (
            <Badge key={locale} variant="outline" className="font-mono">
              {locale}
            </Badge>
          ))}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="mt-auto self-start"
          aria-label={t('snapshots.timeline.openVersionOf', { title })}
          onClick={() => onOpen(card)}
        >
          <History aria-hidden="true" />
          {t('snapshots.timeline.openVersion')}
        </Button>
      </div>
    </li>
  );
};
