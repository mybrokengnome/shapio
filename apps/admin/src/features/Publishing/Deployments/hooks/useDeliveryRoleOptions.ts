import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useRoles } from '@/api/roles';
import type { SelectOption } from '@/components/FormSelectField';
import { NO_DELIVERY_ROLE } from '../helpers/connectionForm';

/** "Public fields" plus every delivery role: what a connection's previews read with. */
export const useDeliveryRoleOptions = (): SelectOption[] => {
  const { t } = useTranslation();
  const roles = useRoles().data;
  return useMemo(
    () => [
      { value: NO_DELIVERY_ROLE, label: t('publishing.deployments.deliveryRoleNone') },
      ...(roles ?? [])
        .filter((role) => role.kind === 'delivery')
        .map((role) => ({ value: role.id, label: role.name })),
    ],
    [roles, t],
  );
};
