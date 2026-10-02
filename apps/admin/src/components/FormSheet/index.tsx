import type { FormEventHandler, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { FieldGroup } from '@/components/ui/field';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { cn } from '@/helpers/cn';
import { useDiscardGuard } from '@/hooks/useDiscardGuard';
import { SubmitButton } from '../SubmitButton';

type FormSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  /** Unsaved edits: closing asks before discarding them. */
  dirty: boolean;
  pending: boolean;
  submitLabel: string;
  pendingLabel: string;
  onSubmit: FormEventHandler<HTMLFormElement>;
  /** sm 400px (default), md 560px, lg 720px from the sm breakpoint; full width on phones. */
  size?: 'sm' | 'md' | 'lg';
  /** Layout overrides for the scrolling body (e.g. a split layout whose panes scroll on their own). */
  bodyClassName?: string;
  /**
   * Runs as the sheet finishes closing, before focus returns to the opener. Call `event.preventDefault()` to
   * keep focus where it is (e.g. on a `SecretReveal` that took it).
   */
  onCloseAutoFocus?: (event: Event) => void;
  children: ReactNode;
};

/**
 * A form in a right-hand sheet: create or edit a record while the list stays in view. Labelled,
 * keyboard-closable and protected against losing unsaved edits; the header and the footer (Cancel, then the
 * primary action) stay put while a long body scrolls.
 */
export const FormSheet = ({
  open,
  onOpenChange,
  title,
  description,
  dirty,
  pending,
  submitLabel,
  pendingLabel,
  onSubmit,
  size,
  bodyClassName,
  onCloseAutoFocus,
  children,
}: FormSheetProps) => {
  const { t } = useTranslation();
  const { requestOpenChange, discardPrompt } = useDiscardGuard({ dirty, pending, onOpenChange });
  return (
    <>
      <Sheet open={open} onOpenChange={requestOpenChange}>
        <SheetContent
          size={size}
          {...(description ? {} : { 'aria-describedby': undefined })}
          {...(onCloseAutoFocus ? { onCloseAutoFocus } : {})}
        >
          <SheetHeader className="pr-14">
            <SheetTitle>{title}</SheetTitle>
            {description ? <SheetDescription>{description}</SheetDescription> : null}
          </SheetHeader>
          <form noValidate onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
            {/* The scrolling body is the field group itself, so `bodyClassName` lays out the fields. */}
            <FieldGroup
              className={cn('relative min-h-0 flex-1 gap-5 overflow-y-auto px-6 pt-1 pb-6', bodyClassName)}
            >
              {children}
            </FieldGroup>
            <SheetFooter>
              <Button type="button" variant="outline" onClick={() => requestOpenChange(false)}>
                {t('common.cancel')}
              </Button>
              <SubmitButton pending={pending} pendingLabel={pendingLabel}>
                {submitLabel}
              </SubmitButton>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>
      {discardPrompt}
    </>
  );
};
