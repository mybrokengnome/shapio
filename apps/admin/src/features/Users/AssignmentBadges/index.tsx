import type { RoleAssignment } from '@shapio/client';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';

type AssignmentBadgesProps = {
  assignments: readonly RoleAssignment[];
  roleNames: ReadonlyMap<string, string>;
  /** Site names by ID; with one site or none, only the role is shown (there is no other site). */
  siteNames: ReadonlyMap<string, string>;
};

/** A user's or invitation's role assignments: "Editor · All sites", "Viewer · Blog". */
export const AssignmentBadges = ({ assignments, roleNames, siteNames }: AssignmentBadgesProps) => {
  const { t } = useTranslation();
  const showSites = siteNames.size > 1;
  return assignments.map(({ roleId, siteId }) => {
    const role = roleNames.get(roleId) ?? t('common.unknown');
    const site =
      siteId === null ? t('sites.switcher.allSites') : (siteNames.get(siteId) ?? t('common.unknown'));
    return (
      <Badge key={`${roleId}:${siteId ?? ''}`} variant="outline">
        {showSites ? t('users.access.badge', { role, site }) : role}
      </Badge>
    );
  });
};
