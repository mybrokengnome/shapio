import type { AdminUser } from '@shapio/client';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { useAdminRoleOptionsAndDefaults } from '../hooks/useAdminRoleOptionsAndDefaults';
import { useIsOwner } from '../hooks/useIsOwner';
import { useUserRoleForm } from '../hooks/useUserRoleForm';
import { RolesPopover } from '../RolesPopover';

type RolesEditorProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: AdminUser;
  /** The row's roles, which the radio list points at. */
  children: ReactElement;
};

/**
 * Changes an admin user's role (exactly one) in a radio list anchored to their row. Owner is offered only to
 * owners, or when the user already holds it (so the current role shows as chosen).
 */
export const RolesEditor = ({ open, onOpenChange, user, children }: RolesEditorProps) => {
  const { t } = useTranslation();
  const isOwner = useIsOwner();
  const {
    options,
    heldRoleId,
    error: rolesError,
  } = useAdminRoleOptionsAndDefaults({ includeOwner: isOwner, heldRoleIds: user.roleIds });
  const { form, onSubmit, updateUser } = useUserRoleForm(open, user, heldRoleId, () => onOpenChange(false));
  return (
    <RolesPopover
      open={open}
      onOpenChange={onOpenChange}
      title={t('users.rolesTitle', { name: user.name || user.email })}
      selection="single"
      control={form.control}
      options={options}
      dirty={form.formState.isDirty}
      pending={updateUser.isPending}
      error={updateUser.error ?? rolesError}
      onSubmit={(event) => void onSubmit(event)}
    >
      {children}
    </RolesPopover>
  );
};
