import { useTranslation } from 'react-i18next';
import { useMe } from '@/api/auth';
import { SubNav, SubNavGroup } from '@/components/SubNav';
import { SubNavLink } from '@/components/SubNavLink';
import { SETTINGS_GROUPS } from '../sections';

/** Settings sections, grouped (Account, Workspace, Developer); groups the admin can't use are hidden. */
export const Nav = () => {
  const { t } = useTranslation();
  const permissions = useMe().data?.globalPermissions ?? [];
  return (
    <SubNav label={t('settings.sections')}>
      {SETTINGS_GROUPS.map((group) => {
        const sections = group.sections.filter(
          (section) => !section.permission || permissions.includes(section.permission),
        );
        return sections.length === 0 ? null : (
          <SubNavGroup key={group.key} label={t(`settings.${group.key}`)}>
            {sections.map((section) => {
              const Icon = section.icon;
              return (
                <SubNavLink key={section.key} to={section.to}>
                  <Icon aria-hidden="true" />
                  {t(`settings.${section.key}`)}
                </SubNavLink>
              );
            })}
          </SubNavGroup>
        );
      })}
    </SubNav>
  );
};
