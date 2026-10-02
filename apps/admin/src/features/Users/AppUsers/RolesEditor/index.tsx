import type { AdminAppUser } from '@shapio/client';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { RolesPopover } from '../../RolesPopover';
import { useAppRoleOptions } from '../hooks/useAppRoleOptions';
import { useAppUserRolesForm } from '../hooks/useAppUserRolesForm';

type RolesEditorProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: AdminAppUser;
  /** The row's roles, which the checklist points at. */
  children: ReactElement;
};

/** Changes an app user's custom roles in a checklist anchored to their row. */
export const RolesEditor = ({ open, onOpenChange, user, children }: RolesEditorProps) => {
  const { t } = useTranslation();
  const { options, error: rolesError, isPending } = useAppRoleOptions();
  const { form, onSubmit, updateAppUser } = useAppUserRolesForm(open, user, () => onOpenChange(false));
  return (
    <RolesPopover
      open={open}
      onOpenChange={onOpenChange}
      title={t('appUsers.rolesTitle', { name: user.name || user.email })}
      description={t('appUsers.rolesDescription')}
      selection="multiple"
      control={form.control}
      options={options}
      {...(isPending ? {} : { emptyMessage: t('appUsers.noCustomRoles') })}
      dirty={form.formState.isDirty}
      pending={updateAppUser.isPending}
      error={updateAppUser.error ?? rolesError}
      onSubmit={(event) => void onSubmit(event)}
    >
      {children}
    </RolesPopover>
  );
};
