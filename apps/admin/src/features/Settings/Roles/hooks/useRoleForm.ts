import { zodResolver } from '@hookform/resolvers/zod';
import type { PermissionAction, Role, RolePermission } from '@shapio/client';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { useCreateRole, useUpdateRole } from '@/api/roles';
import { i18next } from '@/app/i18n';
import { settle } from '@/helpers/settle';
import { requiredText } from '@/helpers/validation';
import { EDITABLE_ACTIONS, EDITABLE_ACTIONS_BY_KIND, ROLE_KEY_PATTERN } from '../constants';

const roleSchema = z.object({
  key: z.string().trim().regex(ROLE_KEY_PATTERN, 'validation.roleKey'),
  name: requiredText(),
  description: z.string().trim(),
  kind: z.enum(['admin', 'delivery']),
  actions: z.array(
    z.custom<PermissionAction>((value) => EDITABLE_ACTIONS.includes(value as PermissionAction)),
  ),
});

export type RoleValues = z.infer<typeof roleSchema>;

/** A grant this form owns: on every model, unconditional, every field. Anything narrower is left alone. */
const isEveryModelGrant = (permission: RolePermission) =>
  permission.modelId === null && permission.condition === null && permission.fieldIds === null;

const valuesFor = (role: Role | undefined): RoleValues => ({
  key: role?.key ?? '',
  name: role?.name ?? '',
  description: role?.description ?? '',
  kind: role?.kind ?? 'admin',
  actions: (role?.permissions ?? []).filter(isEveryModelGrant).map((permission) => permission.action),
});

const toGrant = (action: PermissionAction): RolePermission => ({
  action,
  modelId: null,
  condition: null,
  fieldIds: null,
});

/** Only the actions the role's kind may hold: switching a new role's kind leaves the other kind's ticks behind. */
const grantsFor = (kind: RoleValues['kind'], actions: readonly PermissionAction[]): RolePermission[] =>
  actions.filter((action) => EDITABLE_ACTIONS_BY_KIND[kind].includes(action)).map(toGrant);

/**
 * Create or edit a role. Editing replaces only the every-model grants shown in the form and keeps any
 * model-, field- or condition-specific grants untouched. Updates send the version the form was opened with
 * (optimistic concurrency: a concurrent change is a VERSION_CONFLICT, not a silent overwrite).
 */
export const useRoleForm = (open: boolean, role: Role | undefined, onDone: () => void) => {
  const createRole = useCreateRole();
  const updateRole = useUpdateRole();
  const form = useForm<RoleValues>({ resolver: zodResolver(roleSchema), defaultValues: valuesFor(role) });
  const { reset } = form;
  // Each time the dialog opens it starts from the role's current values (or a blank role).
  useEffect(() => {
    if (open) {
      reset(valuesFor(role));
    }
  }, [open, role, reset]);
  const onSubmit = form.handleSubmit(async ({ key, name, description, kind, actions }) => {
    if (role) {
      const narrower = role.permissions.filter((permission) => !isEveryModelGrant(permission));
      const updated = await settle(
        updateRole.mutateAsync({
          id: role.id,
          input: {
            expectedVersion: role.version,
            name,
            description,
            permissions: [...narrower, ...grantsFor(kind, actions)],
          },
        }),
      );
      if (!updated.ok) {
        return;
      }
      toast.success(i18next.t('roles.saved'));
    } else {
      const created = await settle(
        createRole.mutateAsync({ key, name, description, kind, permissions: grantsFor(kind, actions) }),
      );
      if (!created.ok) {
        return;
      }
      toast.success(i18next.t('roles.created'));
    }
    onDone();
  });
  const mutation = role ? updateRole : createRole;
  return { form, onSubmit, pending: mutation.isPending, error: mutation.error };
};
