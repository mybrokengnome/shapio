import type { ComponentDefinition, ModelDefinition } from '@shapio/schema';
import { RotateCcw } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useEntryHistory, useRevision } from '@/api/content';
import { ErrorState } from '@/components/ErrorState';
import { InlineConfirm } from '@/components/InlineConfirm';
import { LoadingState } from '@/components/LoadingState';
import { Button } from '@/components/ui/button';
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useEntryForm } from '@/fields/form/context';
import { historyTimeline, revisionRowKey, type HistoryRow } from '../helpers/historyTimeline';
import { diffRevision } from '../helpers/revisionDiff';
import { Row } from './Row';

type HistorySheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  model: ModelDefinition;
  components: ReadonlyMap<string, ComponentDefinition>;
  entryId: string;
  locale: string | null;
  restoring: boolean;
  /** The form has unsaved changes, which restoring replaces: ask first. */
  confirmRestore: boolean;
  /** Restores a revision; a confirmation stays open (with a spinner) until it settles. */
  onRestore: (revisionId: string) => Promise<unknown>;
  /** The revision selected when the sheet first opens (a link to one version). */
  initialRevisionId?: string;
};

const revisionIdOf = (row: HistoryRow) =>
  row.kind === 'revision' ? row.revision.id : row.publication.revisionId;

const CHANGE_KEYS = {
  added: 'content.history.changes.added',
  removed: 'content.history.changes.removed',
  changed: 'content.history.changes.changed',
} as const;

/**
 * The entry's history in this locale: revisions (explicit saves, restores; autosaves are not history) with
 * who made them, and when it was published or unpublished, by whom. Choosing a revision (or a publication,
 * which picks the revision it put live) shows which fields differ from the form now; restoring brings it back
 * as a new revision.
 */
export const HistorySheet = ({
  open,
  onOpenChange,
  model,
  components,
  entryId,
  locale,
  restoring,
  confirmRestore,
  onRestore,
  initialRevisionId,
}: HistorySheetProps) => {
  const { t } = useTranslation();
  const current = useEntryForm((state) => state.values);
  const history = useEntryHistory(model.apiKey, entryId, locale ?? undefined, open);
  const rows = useMemo(() => (history.data ? historyTimeline(history.data) : []), [history.data]);
  const [selectedKey, setSelectedKey] = useState<string | undefined>(
    initialRevisionId === undefined ? undefined : revisionRowKey(initialRevisionId),
  );
  const selectedRow = rows.find((row) => row.key === selectedKey);
  const selectedId = selectedRow
    ? revisionIdOf(selectedRow)
    : selectedKey === undefined
      ? undefined
      : initialRevisionId;
  const newestRevision = rows.find((row) => row.kind === 'revision')?.key;
  const revision = useRevision(model.apiKey, entryId, selectedId);
  const changes = revision.data ? diffRevision(model, components, revision.data.data, current) : [];
  const restoreButton = (
    <Button
      type="button"
      size="sm"
      disabled={restoring || revision.isPending}
      onClick={confirmRestore || !selectedId ? undefined : () => void onRestore(selectedId)}
    >
      <RotateCcw aria-hidden="true" />
      {t('content.history.restore')}
    </Button>
  );
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent size="md" aria-describedby={undefined}>
        <SheetHeader>
          <SheetTitle>{t('content.history.title')}</SheetTitle>
        </SheetHeader>
        <SheetBody className="space-y-4">
          {history.isPending ? (
            <LoadingState rows={4} />
          ) : history.isError ? (
            <ErrorState error={history.error} onRetry={() => void history.refetch()} />
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('content.history.empty')}</p>
          ) : (
            <ol aria-label={t('content.history.list')} className="space-y-1">
              {rows.map((row) => (
                <li key={row.key}>
                  <Row
                    row={row}
                    selected={row.key === selectedKey}
                    current={row.key === newestRevision}
                    onSelect={() => setSelectedKey(row.key)}
                  />
                </li>
              ))}
            </ol>
          )}
          {selectedId ? (
            <section aria-labelledby="revision-diff-title" className="space-y-3 rounded-xl border p-4">
              <h3 id="revision-diff-title" className="text-sm font-semibold">
                {t('content.history.diffTitle')}
              </h3>
              {revision.isPending ? (
                <LoadingState rows={2} />
              ) : revision.isError ? (
                <ErrorState error={revision.error} onRetry={() => void revision.refetch()} />
              ) : changes.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('content.history.noChanges')}</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {changes.map((change) => (
                    <li key={change.field.id}>
                      <span className="font-medium">{change.field.label}</span>{' '}
                      <span className="text-muted-foreground">{t(CHANGE_KEYS[change.kind])}</span>
                      {change.before || change.after ? (
                        <span className="mt-0.5 block text-meta text-muted-foreground">
                          {t('content.history.beforeAfter', {
                            before: change.before || '—',
                            after: change.after || '—',
                          })}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
              {confirmRestore ? (
                <InlineConfirm
                  tone="default"
                  align="start"
                  title={t('content.history.restoreTitle')}
                  description={t('content.history.restoreDescription')}
                  confirmLabel={t('content.history.restoreConfirm')}
                  onConfirm={() => onRestore(selectedId)}
                  trigger={restoreButton}
                />
              ) : (
                restoreButton
              )}
            </section>
          ) : null}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
};
