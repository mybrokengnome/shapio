import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '@/components/ConfirmDialog';

type UseDiscardGuardOptions = {
  /** Unsaved edits: closing asks before discarding them. */
  dirty: boolean;
  /** While a save runs, closing is not intercepted (the caller blocks it or lets it finish). */
  pending?: boolean;
  /** The overlay's own open/close handler, called once closing is allowed. */
  onOpenChange: (open: boolean) => void;
};

/**
 * Dirty-close protection for a sheet (or any overlay with `onOpenChange`). Pass `requestOpenChange` to the
 * overlay instead of `onOpenChange` and render `discardPrompt` beside it: Escape, the overlay, the close
 * button and Cancel then ask "Discard unsaved changes?" before closing over unsaved edits.
 */
export const useDiscardGuard = ({
  dirty,
  pending = false,
  onOpenChange,
}: UseDiscardGuardOptions): { requestOpenChange: (open: boolean) => void; discardPrompt: ReactNode } => {
  const { t } = useTranslation();
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const requestOpenChange = (open: boolean) => {
    if (!open && dirty && !pending) {
      setConfirmingDiscard(true);
      return;
    }
    onOpenChange(open);
  };
  const discardPrompt = (
    <ConfirmDialog
      open={confirmingDiscard}
      onOpenChange={setConfirmingDiscard}
      title={t('unsaved.title')}
      description={t('unsaved.description')}
      cancelLabel={t('unsaved.stay')}
      confirmLabel={t('unsaved.leave')}
      destructive
      onConfirm={() => {
        setConfirmingDiscard(false);
        onOpenChange(false);
      }}
    />
  );
  return { requestOpenChange, discardPrompt };
};
