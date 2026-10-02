import { AlertCircle, Check, Loader2, Pencil } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/helpers/cn';
import { formatDateTime } from '@/helpers/formatDate';
import type { SaveState as SaveStateValue } from '../hooks/useEntrySaver';

type SaveStateProps = { state: SaveStateValue; dirty: boolean; autosaved: boolean };

/** Where the draft stands: saving, unsaved changes, autosaved, saved, or a failed save. Announced politely. */
export const SaveState = ({ state, dirty, autosaved }: SaveStateProps) => {
  const { t } = useTranslation();
  const [Icon, text] =
    state.status === 'saving'
      ? [Loader2, t('content.save.saving')]
      : state.status === 'failed'
        ? [AlertCircle, t('content.save.failed')]
        : dirty
          ? [Pencil, t('content.save.unsaved')]
          : state.status === 'saved'
            ? [
                Check,
                state.kind === 'autosave'
                  ? t('content.save.autosavedAt', { time: formatDateTime(state.at) })
                  : t('content.save.savedAt', { time: formatDateTime(state.at) }),
              ]
            : autosaved
              ? [Check, t('content.save.draftAutosaved')]
              : [Check, t('content.save.allSaved')];
  return (
    <p
      role="status"
      aria-live="polite"
      className={cn('flex items-center gap-1.5', state.status === 'failed' && 'text-destructive')}
    >
      <Icon
        aria-hidden="true"
        className={cn('size-3.5 shrink-0', state.status === 'saving' && 'animate-spin')}
      />
      {text}
    </p>
  );
};
