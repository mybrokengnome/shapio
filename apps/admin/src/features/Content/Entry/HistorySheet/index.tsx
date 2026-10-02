import type { ComponentDefinition, ModelDefinition } from '@shapio/schema';
import { History, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useRevision, useRevisions } from '@/api/content';
import { ErrorState } from '@/components/ErrorState';
import { InlineConfirm } from '@/components/InlineConfirm';
import { LoadingState } from '@/components/LoadingState';
import { Button } from '@/components/ui/button';
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useEntryForm } from '@/fields/form/context';
import { cn } from '@/helpers/cn';
import { formatDateTime } from '@/helpers/formatDate';
import { diffRevision } from '../helpers/revisionDiff';

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

const CHANGE_KEYS = {
  added: 'content.history.changes.added',
  removed: 'content.history.changes.removed',
  changed: 'content.history.changes.changed',
} as const;

/**
 * The entry's revisions in this locale (explicit saves, publishes, restores; autosaves are not history).
 * Choosing one shows which fields differ from the form now; restoring brings it back as a new revision.
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
  const revisions = useRevisions(model.apiKey, entryId, locale ?? undefined, open);
  const [selectedId, setSelectedId] = useState<string | undefined>(initialRevisionId);
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
          {revisions.isPending ? (
            <LoadingState rows={4} />
          ) : revisions.isError ? (
            <ErrorState error={revisions.error} onRetry={() => void revisions.refetch()} />
          ) : revisions.data.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('content.history.empty')}</p>
          ) : (
            <ol aria-label={t('content.history.list')} className="space-y-1">
              {revisions.data.map((item, index) => {
                const key = reasonKey(item.reason);
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      aria-pressed={item.id === selectedId}
                      onClick={() => setSelectedId(item.id)}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50',
                        item.id === selectedId && 'bg-accent text-accent-foreground',
                      )}
                    >
                      <History aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1">
                        <span className="block font-semibold">{key ? t(key) : item.reason}</span>
                        <span className="block text-meta text-muted-foreground">
                          {formatDateTime(item.createdAt)}
                          {index === 0 ? ` · ${t('content.history.latest')}` : ''}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
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
