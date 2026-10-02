import { Loader2 } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button, buttonVariants } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldLabel } from '@/components/ui/field';
import { FormError } from '../FormError';

type ConfirmDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  /** When set, Confirm stays disabled until this statement is checked (unticked on every open). */
  acknowledgement?: string;
  /**
   * Async mode: pass the mutation's pending state. Confirm then doesn't close the dialog; the caller closes
   * it on success. While pending, Confirm shows `pendingLabel` and the dialog can't be dismissed.
   */
  pending?: boolean;
  pendingLabel?: string;
  /** The failed attempt's error, shown above the buttons (async mode). */
  error?: unknown;
};

/**
 * A blocking yes/no question, kept only for irreversible acknowledgements (DESIGN.md "Dialogs"). Focus starts
 * on Cancel (Radix default).
 */
export const ConfirmDialog = ({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
  destructive = false,
  onConfirm,
  acknowledgement,
  pending,
  pendingLabel,
  error,
}: ConfirmDialogProps) => {
  const { t } = useTranslation();
  const acknowledgementId = useId();
  const [acknowledged, setAcknowledged] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setAcknowledged(false);
    }
  }
  const isAsync = pending !== undefined;
  const busy = pending === true;
  const blocked = acknowledgement !== undefined && !acknowledged;
  const confirmClassName = buttonVariants({ variant: destructive ? 'destructive' : 'default' });
  return (
    <AlertDialog open={open} onOpenChange={(next) => (busy && !next ? undefined : onOpenChange(next))}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {acknowledgement ? (
          <Field orientation="horizontal">
            <Checkbox
              id={acknowledgementId}
              checked={acknowledged}
              disabled={busy}
              onCheckedChange={(checked) => setAcknowledged(checked === true)}
            />
            <FieldLabel htmlFor={acknowledgementId} className="font-normal">
              {acknowledgement}
            </FieldLabel>
          </Field>
        ) : null}
        {isAsync ? <FormError error={error} /> : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{cancelLabel ?? t('common.cancel')}</AlertDialogCancel>
          {isAsync ? (
            <Button
              type="button"
              variant={destructive ? 'destructive' : 'default'}
              disabled={busy || blocked}
              aria-busy={busy || undefined}
              onClick={onConfirm}
            >
              {busy ? (
                <>
                  <Loader2 className="animate-spin" aria-hidden="true" />
                  {pendingLabel ?? confirmLabel}
                </>
              ) : (
                confirmLabel
              )}
            </Button>
          ) : (
            <AlertDialogAction className={confirmClassName} disabled={blocked} onClick={onConfirm}>
              {confirmLabel}
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
