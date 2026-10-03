import type { Invitation } from '@shapio/client';
import { useTranslation } from 'react-i18next';
import { FormError } from '@/components/FormError';
import { FormSheet } from '@/components/FormSheet';
import { FormTextField } from '@/components/FormTextField';
import { AssignmentsField } from '../AssignmentsField';
import { useAssignmentOptions } from '../hooks/useAssignmentOptions';
import { useInviteForm } from '../hooks/useInviteForm';

type InviteSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Runs once the invitation exists, while the sheet is still pending (e.g. to fetch its link). */
  onInvited: (invitation: Invitation) => Promise<unknown>;
  /** Keeps focus where it is when the sheet closes (on a link that just appeared). */
  onCloseAutoFocus: (event: Event) => void;
};

/**
 * Invites someone by email with a role on all sites, or one role per site where there are several (Editor
 * on all sites preselected; Owner isn't offered).
 */
export const InviteSheet = ({ open, onOpenChange, onInvited, onCloseAutoFocus }: InviteSheetProps) => {
  const { t } = useTranslation();
  const options = useAssignmentOptions({ includeOwner: false });
  const { form, onSubmit, invite } = useInviteForm({
    open,
    defaultRoleId: options.editorRoleId,
    ownerRoleId: options.ownerRoleId,
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
      <AssignmentsField
        control={form.control}
        roleOptions={options.roleOptions}
        siteOptions={options.siteOptions}
        siteIds={options.siteIds}
        multiSite={options.multiSite}
        defaultRoleId={options.editorRoleId}
      />
      <FormError error={invite.error ?? options.error} />
    </FormSheet>
  );
};
