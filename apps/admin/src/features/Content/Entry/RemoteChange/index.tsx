import { RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { formatDateTime } from '@/helpers/formatDate';
import { changedWhen } from '../helpers/changedWhen';
import type { RemoteChange as RemoteChangeValue } from '../hooks/useRemoteDraftChange';

type RemoteChangeProps = {
  change: RemoteChangeValue;
  busy: boolean;
  onReload: () => void;
  /** "Changed elsewhere" and an icon-only Reload: the bar is narrow (drawer or preview open). */
  compact?: boolean;
};

/**
 * In place of the save state when the draft moved on the server and this tab has no edits of its own:
 * who changed it and when, and Reload to show it. Announced politely; the full sentence is the `title` (and
 * the only place the name shows while the bar is narrow).
 */
export const RemoteChange = ({ change, busy, onReload, compact = false }: RemoteChangeProps) => {
  const { t } = useTranslation();
  const when = changedWhen(change.savedAt, t('entry.remoteChange.momentAgo'));
  const { savedBy } = change;
  const full = savedBy
    ? savedBy.you
      ? t('entry.remoteChange.byYou', { when })
      : t('entry.remoteChange.by', { name: savedBy.name, when })
    : t('entry.remoteChange.unknown', { when });
  return (
    <div className="flex min-w-0 items-center gap-2">
      <p
        role="status"
        aria-live="polite"
        title={`${full} (${formatDateTime(change.savedAt)})`}
        className="min-w-0 truncate text-foreground"
      >
        {compact ? t('entry.remoteChange.short') : full}
      </p>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button type="button" variant="outline" size="xs" disabled={busy} onClick={onReload}>
            <RefreshCw aria-hidden="true" />
            <span className={compact ? 'sr-only' : undefined}>{t('entry.remoteChange.reload')}</span>
          </Button>
        </TooltipTrigger>
        {compact ? <TooltipContent>{t('entry.remoteChange.reload')}</TooltipContent> : null}
      </Tooltip>
    </div>
  );
};
