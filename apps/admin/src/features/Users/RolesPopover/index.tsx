import type { FormEventHandler, ReactElement } from 'react';
import type { Control } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { FormCheckboxGroup, type CheckboxOption } from '@/components/FormCheckboxGroup';
import { FormError } from '@/components/FormError';
import { FormRadioGroup, type RadioOption } from '@/components/FormRadioGroup';
import { SubmitButton } from '@/components/SubmitButton';
import { Button } from '@/components/ui/button';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { useDiscardGuard } from '@/hooks/useDiscardGuard';
import { useReturnFocus } from '@/hooks/useReturnFocus';

export type RolesValues = { roleIds: string[] };

/** One role (admin users). */
export type SingleRoleValues = { roleId: string };

/** Several roles as a checklist (app users), or exactly one as a radio list (admin users). */
type RolesSelection =
  | { selection: 'multiple'; control: Control<RolesValues>; options: readonly CheckboxOption[] }
  | { selection: 'single'; control: Control<SingleRoleValues>; options: readonly RadioOption[] };

type RolesPopoverProps = RolesSelection & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** "Roles for Ada": the checklist's legend and the popover's accessible name. */
  title: string;
  /** One line under the checklist. */
  description?: string;
  /** Shown instead of the checklist when there is nothing to pick. */
  emptyMessage?: string;
  dirty: boolean;
  pending: boolean;
  error: unknown;
  onSubmit: FormEventHandler<HTMLFormElement>;
  /** What the checklist points at: the row's roles. */
  children: ReactElement;
};

/**
 * A user's roles as a checklist (or a radio list, for one role) in a popover anchored to the row
 * (DESIGN.md "Dialogs": pick from a short list). Opened from the row's menu, so focus returns to the menu
 * button; closing over unsaved changes asks first.
 */
export const RolesPopover = ({
  open,
  onOpenChange,
  title,
  description,
  emptyMessage,
  dirty,
  pending,
  error,
  onSubmit,
  children,
  ...selection
}: RolesPopoverProps) => {
  const { t } = useTranslation();
  const { requestOpenChange, discardPrompt } = useDiscardGuard({ dirty, pending, onOpenChange });
  const returnFocus = useReturnFocus();
  return (
    <>
      <Popover
        open={open}
        onOpenChange={(next) => (pending && !next ? undefined : requestOpenChange(next))}
        modal
      >
        <PopoverAnchor asChild>{children}</PopoverAnchor>
        <PopoverContent aria-label={title} align="start" className="w-80 p-0" {...returnFocus}>
          <form noValidate onSubmit={onSubmit}>
            <div className="max-h-72 space-y-3 overflow-y-auto p-4">
              {selection.options.length > 0 || !emptyMessage ? (
                selection.selection === 'single' ? (
                  <FormRadioGroup
                    control={selection.control}
                    name="roleId"
                    legend={title}
                    options={selection.options}
                  />
                ) : (
                  <FormCheckboxGroup
                    control={selection.control}
                    name="roleIds"
                    legend={title}
                    options={selection.options}
                  />
                )
              ) : (
                <p className="text-sm text-muted-foreground">{emptyMessage}</p>
              )}
              {description ? <p className="text-meta text-muted-foreground">{description}</p> : null}
              <FormError error={error} />
            </div>
            <div className="flex justify-end gap-2 border-t px-4 py-3">
              <Button type="button" size="sm" variant="outline" onClick={() => requestOpenChange(false)}>
                {t('common.cancel')}
              </Button>
              <SubmitButton size="sm" pending={pending} pendingLabel={t('common.saving')}>
                {t('common.saveChanges')}
              </SubmitButton>
            </div>
          </form>
        </PopoverContent>
      </Popover>
      {discardPrompt}
    </>
  );
};
