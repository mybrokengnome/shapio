import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSites } from '@/api/sites';
import type { SelectOption } from '@/components/FormSelectField';
import { ALL_SITES } from '../helpers/assignments';
import { useAdminRoleOptionsAndDefaults } from './useAdminRoleOptionsAndDefaults';

type AssignmentOptionsInput = {
  /** Offer the owner role (owners only; the server refuses anyone else). */
  includeOwner: boolean;
  heldRoleIds?: readonly string[];
};

/**
 * What an assignment row can name: the admin roles, and the sites ("All sites" first). `multiSite` is false
 * on an instance with one site, where the site isn't a choice and the form is just the role.
 */
export const useAssignmentOptions = ({ includeOwner, heldRoleIds }: AssignmentOptionsInput) => {
  const { t } = useTranslation();
  const roles = useAdminRoleOptionsAndDefaults({ includeOwner, ...(heldRoleIds ? { heldRoleIds } : {}) });
  const sites = useSites();
  const siteOptions = useMemo<SelectOption[]>(
    () => [
      { value: ALL_SITES, label: t('sites.switcher.allSites') },
      ...(sites.data ?? []).map((site) => ({ value: site.id, label: site.name })),
    ],
    [sites.data, t],
  );
  const siteIds = useMemo(() => (sites.data ?? []).map((site) => site.id), [sites.data]);
  return {
    roleOptions: roles.options,
    siteOptions,
    siteIds,
    multiSite: siteIds.length > 1,
    editorRoleId: roles.editorRoleId,
    ownerRoleId: roles.ownerRoleId,
    error: roles.error ?? sites.error,
  };
};
