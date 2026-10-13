import { Shapes } from 'lucide-react';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { FormError } from '@/components/FormError';
import { InfoHint } from '@/components/InfoHint';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import type { useChangeKind } from '../hooks/useChangeKind';

type ChangeKindProps = {
  changeKind: ReturnType<typeof useChangeKind>;
  /** The entry's title, for the confirmation. */
  title: string;
  /** Unsaved edits: the change waits for a save. */
  dirty: boolean;
};

/**
 * "Change kind" in the danger zone: pick another kind of the entry's family, see which fields' values would
 * be dropped (the server's dry run), then confirm in a blocking dialog (DESIGN.md: an irreversible
 * acknowledgement), ticking the acknowledgement when values are dropped.
 */
export const ChangeKind = ({ changeKind, title, dirty }: ChangeKindProps) => {
  const { t, i18n } = useTranslation();
  const labelId = useId();
  const noteId = useId();
  const { targets, target, preview } = changeKind;
  const dropped = preview.data?.droppedFields ?? [];
  const droppedNames = new Intl.ListFormat(i18n.language, { type: 'conjunction' }).format(
    dropped.map((field) => `“${field.label}”`),
  );
  const unavailable = dirty || targets.length === 0;
  return (
    <div className="space-y-2 border-t pt-3">
      <div className="flex items-center gap-1">
        <h4 id={labelId} className="text-sm font-semibold">
          {t('entry.changeKind.title')}
        </h4>
        <InfoHint about={t('entry.changeKind.title')}>{t('entry.changeKind.hint')}</InfoHint>
      </div>
      <Select value={target?.apiKey ?? ''} onValueChange={changeKind.pick} disabled={unavailable}>
        <SelectTrigger
          size="sm"
          className="w-full"
          aria-labelledby={labelId}
          aria-describedby={unavailable ? noteId : undefined}
        >
          <SelectValue placeholder={t('entry.changeKind.placeholder')} />
        </SelectTrigger>
        <SelectContent>
          {targets.map((kind) => (
            <SelectItem key={kind.id} value={kind.apiKey}>
              {kind.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {unavailable ? (
        <p id={noteId} className="text-meta text-muted-foreground">
          {dirty ? t('entry.changeKind.saveFirst') : t('entry.changeKind.noTargets')}
        </p>
      ) : target ? (
        <div className="space-y-2" aria-live="polite">
          {preview.isPending ? (
            <Skeleton className="h-4 w-48" />
          ) : preview.isError ? (
            <FormError error={preview.error} />
          ) : (
            <p className="text-meta">
              {dropped.length > 0
                ? t('entry.changeKind.drops', { count: dropped.length, fields: droppedNames })
                : t('entry.changeKind.dropsNothing')}
            </p>
          )}
          <Button
            type="button"
            variant="destructive-ghost"
            size="sm"
            disabled={!preview.isSuccess}
            onClick={() => changeKind.setConfirmOpen(true)}
          >
            <Shapes aria-hidden="true" />
            {t('entry.changeKind.action', { kind: target.label })}
          </Button>
        </div>
      ) : null}
      {target ? (
        <ConfirmDialog
          open={changeKind.confirmOpen}
          onOpenChange={changeKind.setConfirmOpen}
          title={t('entry.changeKind.confirmTitle', { entry: title, kind: target.label })}
          description={
            dropped.length > 0
              ? t('entry.changeKind.confirmDrops', { count: dropped.length, fields: droppedNames })
              : t('entry.changeKind.confirmKeeps')
          }
          acknowledgement={
            dropped.length > 0 ? t('entry.changeKind.acknowledge', { count: dropped.length }) : undefined
          }
          confirmLabel={t('entry.changeKind.confirm')}
          destructive
          onConfirm={changeKind.run}
          pending={changeKind.pending}
          pendingLabel={t('entry.changeKind.pending')}
          error={changeKind.error}
        />
      ) : null}
    </div>
  );
};
