import { Loader2 } from 'lucide-react';
import { useId, useRef, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useReturnFocus } from '@/hooks/useReturnFocus';
import { FormError } from '../FormError';

type InlineConfirmCommonProps = {
  /** The question, and the popover's accessible name ("Delete “Hero”?"). */
  title: string;
  /** The consequence, in one line. */
  description?: string;
  confirmLabel: string;
  cancelLabel?: string;
  /** Shown on Confirm while an async `onConfirm` runs. */
  pendingLabel?: string;
  /** `danger`: red Confirm, focus starts on Cancel. `default`: primary Confirm, focus starts on it. */
  tone: 'danger' | 'default';
  /**
   * Runs on Confirm. Return nothing to close at once; return a promise (`mutateAsync`) to keep the popover
   * open with a spinner until it settles: it closes when it resolves and shows the error when it rejects.
   */
  onConfirm: () => void | Promise<unknown>;
  align?: 'start' | 'center' | 'end';
  side?: 'top' | 'right' | 'bottom' | 'left';
  /**
   * Runs as the popover closes, before focus returns to the opener. Call `event.preventDefault()` to keep
   * focus where it is (e.g. on a `SecretReveal` that a confirmed rotate just showed).
   */
  onCloseAutoFocus?: (event: Event) => void;
};

/** Trigger mode: the popover opens from this button (it gets `aria-expanded` and returns focus to it). */
type TriggerModeProps = InlineConfirmCommonProps & {
  trigger: ReactElement;
  open?: never;
  onOpenChange?: never;
  children?: never;
};

/**
 * Anchored mode, for actions in a menu (a menu item disappears with its menu): the caller opens it (from
 * the item's `onSelect`) and the popover points at `children`, usually the menu's own trigger button.
 */
type AnchoredModeProps = InlineConfirmCommonProps & {
  trigger?: never;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactElement;
};

type InlineConfirmProps = TriggerModeProps | AnchoredModeProps;

/**
 * Confirms a routine destructive or consequential action where it was asked for (DESIGN.md "Dialogs"): a
 * modal popover with role `alertdialog`, the question, one line of consequence and Cancel / Confirm. Escape
 * or a click outside cancels, Enter activates the focused button, focus returns to the opener.
 */
export const InlineConfirm = (props: InlineConfirmProps) => {
  const {
    title,
    description,
    confirmLabel,
    cancelLabel,
    pendingLabel,
    tone,
    onConfirm,
    align = 'end',
    side = 'bottom',
    onCloseAutoFocus,
  } = props;
  const { t } = useTranslation();
  const titleId = useId();
  const descriptionId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const open = props.trigger === undefined ? props.open : uncontrolledOpen;

  const changeOpen = (next: boolean) => {
    if (next) {
      setError(null);
    }
    if (props.trigger === undefined) {
      props.onOpenChange(next);
    } else {
      setUncontrolledOpen(next);
    }
  };
  // Nothing dismisses it while the action runs.
  const requestOpenChange = (next: boolean) => (pending && !next ? undefined : changeOpen(next));

  const confirm = () => {
    const result = onConfirm();
    if (!(result instanceof Promise)) {
      changeOpen(false);
      return;
    }
    setPending(true);
    setError(null);
    result.then(
      () => {
        setPending(false);
        changeOpen(false);
      },
      (reason: unknown) => {
        // Already logged and toasted by the mutation cache; shown here too, beside the action that failed.
        setPending(false);
        setError(reason);
      },
    );
  };

  const returnFocus = useReturnFocus((event) => {
    event.preventDefault();
    (tone === 'danger' ? cancelRef : confirmRef).current?.focus();
  }, onCloseAutoFocus);

  return (
    <Popover open={open} onOpenChange={requestOpenChange} modal>
      {props.trigger === undefined ? (
        <PopoverAnchor asChild>{props.children}</PopoverAnchor>
      ) : (
        <PopoverTrigger asChild>{props.trigger}</PopoverTrigger>
      )}
      <PopoverContent
        role="alertdialog"
        // Modal like Radix's own dialogs: focus is trapped and the rest of the page is aria-hidden. Declaring
        // it lets assistive technology (and axe's aria-hidden-focus rule) know the hidden page is inert.
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        align={align}
        side={side}
        className="w-80 space-y-4"
        {...returnFocus}
      >
        <div className="space-y-1">
          <p id={titleId} className="text-sm font-semibold">
            {title}
          </p>
          {description ? (
            <p id={descriptionId} className="text-meta text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
        <FormError error={error} />
        <div className="flex justify-end gap-2">
          <Button
            ref={cancelRef}
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => changeOpen(false)}
          >
            {cancelLabel ?? t('common.cancel')}
          </Button>
          <Button
            ref={confirmRef}
            type="button"
            size="sm"
            variant={tone === 'danger' ? 'destructive' : 'default'}
            disabled={pending}
            aria-busy={pending || undefined}
            onClick={confirm}
          >
            {pending ? (
              <>
                <Loader2 className="animate-spin" aria-hidden="true" />
                {pendingLabel ?? confirmLabel}
              </>
            ) : (
              confirmLabel
            )}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
};
