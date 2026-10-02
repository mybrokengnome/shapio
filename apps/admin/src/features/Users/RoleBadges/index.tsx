import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';

type RoleBadgesProps = { roleIds: readonly string[]; roleNames: ReadonlyMap<string, string> };

/** A user's or invitation's roles, by name. */
export const RoleBadges = ({ roleIds, roleNames }: RoleBadgesProps) => {
  const { t } = useTranslation();
  return roleIds.map((roleId) => (
    <Badge key={roleId} variant="outline">
      {roleNames.get(roleId) ?? t('common.unknown')}
    </Badge>
  ));
};
