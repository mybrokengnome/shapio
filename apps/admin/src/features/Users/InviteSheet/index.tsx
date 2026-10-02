import type { Invitation } from '@shapio/client';
import { useTranslation } from 'react-i18next';
import { FormError } from '@/components/FormError';
import { FormRadioGroup } from '@/components/FormRadioGroup';
import { FormSheet } from '@/components/FormSheet';
import { FormTextField } from '@/components/FormTextField';
import { useAdminRoleOptionsAndDefaults } from '../hooks/useAdminRoleOptionsAndDefaults';
import { useInviteForm } from '../hooks/useInviteForm';

type InviteSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Runs once the invitation exists, while the sheet is still pending (e.g. to fetch its link). */
  onInvited: (invitation: Invitation) => Promise<unknown>;
  /** Keeps focus where it is when the sheet closes (on a link that just appeared). */
  onCloseAutoFocus: (event: Event) => void;
};

/** Invites someone by email with exactly one role (Editor preselected; Owner isn't offered). */
export const InviteSheet = ({ open, onOpenChange, onInvited, onCloseAutoFocus }: InviteSheetProps) => {
  const { t } = useTranslation();
  const {
    options,
    editorRoleId,
    error: rolesError,
  } = useAdminRoleOptionsAndDefaults({ includeOwner: false });
  const { form, onSubmit, invite } = useInviteForm({
    open,
    defaultRoleId: editorRoleId,
    onInvited,
    onDone: () => onOpenChange(false),
  });
  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      title={t('users.inviteTitle')}
      dirty={form.formState.isDirty}
      pending={form.formState.isSubmitting}
      submitLabel={t('users.invite')}
      pendingLabel={t('common.saving')}
      onSubmit={(event) => void onSubmit(event)}
      onCloseAutoFocus={onCloseAutoFocus}
    >
      <FormTextField
        control={form.control}
        name="email"
        label={t('users.email')}
        type="email"
        autoComplete="off"
      />
      <FormRadioGroup control={form.control} name="roleId" legend={t('users.role')} options={options} />
      <FormError error={invite.error ?? rolesError} />
    </FormSheet>
  );
};
