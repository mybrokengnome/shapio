import type { AdminUser } from '@shapio/client';
import { useTranslation } from 'react-i18next';
import { FormError } from '@/components/FormError';
import { FormSheet } from '@/components/FormSheet';
import { AssignmentsField } from '../AssignmentsField';
import { useAccessForm } from '../hooks/useAccessForm';
import { useAssignmentOptions } from '../hooks/useAssignmentOptions';
import { useIsOwner } from '../hooks/useIsOwner';

type AccessSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: AdminUser;
};

/**
 * Changes where an admin user works and with which role (sites plan §H). Owner is offered only to owners,
 * or when the user already holds it, and only on all sites.
 */
export const AccessSheet = ({ open, onOpenChange, user }: AccessSheetProps) => {
  const { t } = useTranslation();
  const isOwner = useIsOwner();
  const options = useAssignmentOptions({
    includeOwner: isOwner,
    heldRoleIds: user.assignments.map((assignment) => assignment.roleId),
  });
  const { form, onSubmit, updateUser } = useAccessForm(open, user, options.ownerRoleId, () =>
    onOpenChange(false),
  );
  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      title={t('users.accessTitle', { name: user.name || user.email })}
      dirty={form.formState.isDirty}
      pending={updateUser.isPending}
      submitLabel={t('common.saveChanges')}
      pendingLabel={t('common.saving')}
      onSubmit={(event) => void onSubmit(event)}
    >
      <AssignmentsField
        control={form.control}
        roleOptions={options.roleOptions}
        siteOptions={options.siteOptions}
        siteIds={options.siteIds}
        multiSite={options.multiSite}
        defaultRoleId={options.editorRoleId}
      />
      <FormError error={updateUser.error ?? options.error} />
    </FormSheet>
  );
};
