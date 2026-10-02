import { useAppRoles } from '@/api/appRoles';
import type { CheckboxOption } from '@/components/FormCheckboxGroup';

/** Custom app roles as checkbox options (`public` and `authenticated` apply implicitly, never assigned). */
export const useAppRoleOptions = () => {
  const roles = useAppRoles();
  const options: CheckboxOption[] = (roles.data ?? [])
    .filter((role) => !role.isSystem)
    .map((role) => ({ value: role.id, label: role.name }));
  return { options, error: roles.error, isPending: roles.isPending };
};
