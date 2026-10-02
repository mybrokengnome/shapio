import { Loader2, Send, Trash2, Undo2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { InlineConfirm } from '@/components/InlineConfirm';
import { Button } from '@/components/ui/button';
import type { BulkAction } from '../hooks/useBulkEntryActions';

type BulkBarProps = {
  count: number;
  canPublish: boolean;
  canDelete: boolean;
  running: BulkAction | null;
  onAction: (action: BulkAction) => void;
  onClear: () => void;
};

/**
 * Actions for the selected entries (publish, unpublish in the list's locale, delete) as a pill that floats
 * at the bottom of the list while it scrolls, above the status bar. Delete asks first, above its button.
 */
export const BulkBar = ({ count, canPublish, canDelete, running, onAction, onClear }: BulkBarProps) => {
  const { t } = useTranslation();
  const busy = running !== null;
  const icon = (action: BulkAction, Icon: typeof Send) =>
    running === action ? (
      <Loader2 aria-hidden="true" className="animate-spin" />
    ) : (
      <Icon aria-hidden="true" />
    );
  return (
    <div className="pointer-events-none sticky bottom-4 z-20 flex justify-center md:bottom-[calc(var(--statusbar-h)+1rem)]">
      <div
        role="region"
        aria-label={t('place.bulk.label')}
        className="pointer-events-auto flex max-w-full flex-wrap items-center justify-center gap-2 rounded-3xl border bg-card py-1.5 pr-1.5 pl-4 shadow-lg"
      >
        <span className="text-sm font-semibold whitespace-nowrap" aria-live="polite">
          {t('place.bulk.selected', { count })}
        </span>
        {canPublish ? (
          <>
            <Button size="sm" disabled={busy} onClick={() => onAction('publish')}>
              {icon('publish', Send)}
              {t('content.actions.publish')}
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => onAction('unpublish')}>
              {icon('unpublish', Undo2)}
              {t('content.actions.unpublish')}
            </Button>
          </>
        ) : null}
        {canDelete ? (
          <InlineConfirm
            tone="danger"
            side="top"
            align="center"
            title={t('place.bulk.deleteTitle', { count })}
            description={t('place.bulk.deleteDescription')}
            confirmLabel={t('common.delete')}
            onConfirm={() => onAction('delete')}
            trigger={
              <Button size="sm" variant="destructive-ghost" disabled={busy}>
                {icon('delete', Trash2)}
                {t('common.delete')}
              </Button>
            }
          />
        ) : null}
        <Button
          size="icon-sm"
          variant="ghost"
          disabled={busy}
          aria-label={t('place.bulk.clear')}
          onClick={onClear}
        >
          <X aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
};
