import { CloudOff, History, Send } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { StatusChip } from '@/components/StatusChip';
import { cn } from '@/helpers/cn';
import { formatDateTime } from '@/helpers/formatDate';
import type { HistoryRow } from '../../helpers/historyTimeline';

type RowProps = {
  row: HistoryRow;
  selected: boolean;
  /** The newest revision (the draft the form started from). */
  current: boolean;
  onSelect: () => void;
};

const REASON_KEYS = {
  create: 'content.history.reasons.create',
  save: 'content.history.reasons.save',
  publish: 'content.history.reasons.publish',
  restore: 'content.history.reasons.restore',
  duplicate: 'content.history.reasons.duplicate',
  localize: 'content.history.reasons.localize',
} as const;

const reasonKey = (reason: string) =>
  Object.hasOwn(REASON_KEYS, reason) ? REASON_KEYS[reason as keyof typeof REASON_KEYS] : undefined;

const useRowText = (row: HistoryRow, current: boolean) => {
  const { t } = useTranslation();
  const meta = (by: string | null, ...extra: string[]) =>
    [formatDateTime(row.at), ...(by ? [by] : []), ...extra].join(' · ');
  switch (row.kind) {
    case 'revision': {
      const key = reasonKey(row.revision.reason);
      return {
        title: key ? t(key) : row.revision.reason,
        meta: meta(row.revision.authorName, ...(current ? [t('content.history.latest')] : [])),
      };
    }
    case 'published':
      return {
        title:
          row.publication.via === 'changeSet'
            ? t('content.history.events.publishedWithChangeSet', { title: row.publication.changeSetTitle })
            : row.publication.via === 'schedule'
              ? t('content.history.events.publishedOnSchedule')
              : t('content.history.events.published'),
        meta: meta(row.publication.publishedBy),
      };
    case 'unpublished':
      return { title: t('content.history.events.unpublished'), meta: meta(row.publication.unpublishedBy) };
  }
};

const ICONS = { revision: History, published: Send, unpublished: CloudOff } as const;

/**
 * One history row. Revisions and publications select a version to compare (a publication selects the
 * revision it put live); an unpublish is a plain line.
 */
export const Row = ({ row, selected, current, onSelect }: RowProps) => {
  const { t } = useTranslation();
  const { title, meta } = useRowText(row, current);
  const Icon = ICONS[row.kind];
  const body = (
    <>
      <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{title}</span>
        <span className="block text-meta text-muted-foreground">{meta}</span>
      </span>
      {row.kind === 'revision' && row.live ? (
        <StatusChip tone="success" size="sm" label={t('content.history.live')} />
      ) : null}
    </>
  );
  if (row.kind === 'unpublished') {
    return <div className="flex w-full items-center gap-3 px-3 py-2 text-sm">{body}</div>;
  }
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50',
        selected && 'bg-accent text-accent-foreground',
      )}
    >
      {body}
    </button>
  );
};
