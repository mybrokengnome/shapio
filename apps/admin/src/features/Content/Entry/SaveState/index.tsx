import { AlertCircle, Check, Loader2, Pencil } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/helpers/cn';
import { formatDateTime } from '@/helpers/formatDate';
import type { SaveState as SaveStateValue } from '../hooks/useEntrySaver';

type SaveStateProps = {
  state: SaveStateValue;
  dirty: boolean;
  autosaved: boolean;
  /** Short text only ("Saved", not "Saved Oct 10, 9:01 PM"): the bar is narrow (drawer or preview open). */
  compact?: boolean;
};

/**
 * Where the draft stands: saving, unsaved changes, autosaved, saved, or a failed save. Announced politely.
 * The time of the last save shows from `xl` when there is room; the full sentence is always the `title`.
 */
export const SaveState = ({ state, dirty, autosaved, compact = false }: SaveStateProps) => {
  const { t } = useTranslation();
  const [Icon, full, short] =
    state.status === 'saving'
      ? [Loader2, t('content.save.saving')]
      : state.status === 'failed'
        ? [AlertCircle, t('content.save.failed')]
        : dirty
          ? [Pencil, t('content.save.unsaved')]
          : state.status === 'saved'
            ? state.kind === 'autosave'
              ? [
                  Check,
                  t('content.save.autosavedAt', { time: formatDateTime(state.at) }),
                  t('content.save.autosaved'),
                ]
              : [
                  Check,
                  t('content.save.savedAt', { time: formatDateTime(state.at) }),
                  t('content.save.saved'),
                ]
            : autosaved
              ? [Check, t('content.save.draftAutosaved')]
              : [Check, t('content.save.allSaved')];
  const brief = short ?? full;
  return (
    <p
      role="status"
      aria-live="polite"
      title={full}
      className={cn('flex min-w-0 items-center gap-1.5', state.status === 'failed' && 'text-destructive')}
    >
      <Icon
        aria-hidden="true"
        className={cn('size-3.5 shrink-0', state.status === 'saving' && 'animate-spin')}
      />
      {compact || brief === full ? (
        <span className="truncate">{brief}</span>
      ) : (
        <>
          <span className="truncate xl:hidden">{brief}</span>
          <span className="truncate max-xl:hidden">{full}</span>
        </>
      )}
    </p>
  );
};
