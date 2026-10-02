import type { ReviewEntryItem } from '@shapio/client';
import { Link } from '@tanstack/react-router';
import { Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { InlineConfirm } from '@/components/InlineConfirm';
import { Panel } from '@/components/Panel';
import { StatusChip } from '@/components/StatusChip';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PUBLICATION_ACTION_LABELS } from '@/features/Publishing/constants';
import { ValueCell } from './ValueCell';

const LIVE_STATE_DISPLAY = {
  unpublished: { labelKey: 'changes.review.liveStates.unpublished', tone: 'neutral' },
  published: { labelKey: 'changes.review.liveStates.published', tone: 'success' },
  modified: { labelKey: 'changes.review.liveStates.modified', tone: 'warning' },
  missing: { labelKey: 'changes.review.liveStates.missing', tone: 'danger' },
} as const;

type EntryDiffCardProps = {
  item: ReviewEntryItem;
  /** Removes the item after an inline confirmation; undefined when the set can't change. */
  onRemove: (() => Promise<unknown>) | undefined;
};

/** An entry item as field-level before (live) and after (what ships) rows, for one locale. */
export const EntryDiffCard = ({ item, onRemove }: EntryDiffCardProps) => {
  const { t } = useTranslation();
  const title = item.title ?? item.entryId;
  const live = LIVE_STATE_DISPLAY[item.liveState];
  return (
    <Panel
      title={title}
      titleAs="h3"
      flush
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="font-mono">
            {item.locale}
          </Badge>
          <Badge variant="secondary">{t(PUBLICATION_ACTION_LABELS[item.action])}</Badge>
          <StatusChip tone={live.tone} label={t(live.labelKey)} size="sm" />
          {item.modelKey ? (
            <Button variant="ghost" size="sm" asChild>
              <Link
                to="/content/$modelKey/$entryId"
                params={{ modelKey: item.modelKey, entryId: item.entryId }}
                search={{ locale: item.locale }}
              >
                {t('changes.review.openEntry')}
              </Link>
            </Button>
          ) : null}
          {onRemove ? (
            <InlineConfirm
              tone="danger"
              title={t('changes.review.removeItemTitle', { title })}
              description={t('changes.review.removeItemDescription')}
              confirmLabel={t('common.remove')}
              onConfirm={onRemove}
              trigger={
                <Button
                  variant="destructive-ghost"
                  size="icon-sm"
                  aria-label={t('changes.review.removeItem', { title })}
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              }
            />
          ) : null}
        </div>
      }
    >
      {item.fields.length === 0 ? (
        <p className="px-5 py-4 text-meta text-muted-foreground">{t('changes.review.noFieldChanges')}</p>
      ) : (
        <Table aria-label={t('changes.review.fieldChangesOf', { title })}>
          <TableHeader>
            <TableRow>
              <TableHead>{t('changes.review.field')}</TableHead>
              <TableHead>{t('changes.review.before')}</TableHead>
              <TableHead>{t('changes.review.after')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {item.fields.map((field) => (
              <TableRow key={field.fieldId}>
                <TableCell className="align-top">
                  <span className="block font-semibold">{field.label}</span>
                  <span className="block font-mono text-meta text-muted-foreground">{field.apiKey}</span>
                </TableCell>
                <ValueCell value={field.before} side="before" />
                <ValueCell value={field.after} side="after" />
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {item.issues.length > 0 ? (
        <ul className="space-y-1 border-t px-5 py-3 text-sm text-destructive">
          {item.issues.map((issue) => (
            <li key={`${issue.path}-${issue.code}`}>{issue.message}</li>
          ))}
        </ul>
      ) : null}
    </Panel>
  );
};
