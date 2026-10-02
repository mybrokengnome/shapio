import { useRoles } from '@/api/roles';
import type { RadioOption } from '@/components/FormRadioGroup';
import { SYSTEM_ADMIN_ROLE_KEYS } from '@/constants/roles';

type AdminRoleOptionsInput = {
  /** Offer the owner role (owners only; the server refuses anyone else). */
  includeOwner: boolean;
  /** The roles the user being edited holds: owner is offered when they hold it, and `heldRoleId` is set. */
  heldRoleIds?: readonly string[];
};

/**
 * Roles an admin user can hold (delivery roles are for tokens only), as single-choice options: an admin user
 * has exactly one role. Also returns the default choice for a new user (Editor) and the role the edited user
 * holds now (owner first, for accounts that still carry several roles).
 */
export const useAdminRoleOptionsAndDefaults = ({ includeOwner, heldRoleIds = [] }: AdminRoleOptionsInput) => {
  const roles = useRoles();
  const adminRoles = (roles.data ?? []).filter((role) => role.kind === 'admin');
  const isOwnerRole = (key: string) => key === SYSTEM_ADMIN_ROLE_KEYS.owner;
  const offered = adminRoles.filter(
    (role) => !isOwnerRole(role.key) || includeOwner || heldRoleIds.includes(role.id),
  );
  const options: RadioOption[] = offered.map((role) => ({
    value: role.id,
    label: role.name,
    ...(role.description ? { description: role.description } : {}),
  }));
  const held = offered.filter((role) => heldRoleIds.includes(role.id));
  return {
    options,
    editorRoleId: adminRoles.find((role) => role.key === SYSTEM_ADMIN_ROLE_KEYS.editor)?.id,
    heldRoleId: (held.find((role) => isOwnerRole(role.key)) ?? held[0])?.id ?? '',
    error: roles.error,
  };
};
