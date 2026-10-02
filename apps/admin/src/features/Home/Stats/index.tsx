import { linkOptions } from '@tanstack/react-router';
import { Boxes, Globe, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useHasGlobalPermission } from '@/api/auth';
import { useLocales } from '@/api/locales';
import { useUsers } from '@/api/users';
import { cn } from '@/helpers/cn';
import { Stat } from '../Stat';

type StatsProps = { modelCount: number | undefined };

/** The admin list comes from a users.manage endpoint, so this only mounts for admins who hold it. */
const Admins = () => {
  const { t } = useTranslation();
  const users = useUsers();
  return (
    <Stat
      label={t('home.admins')}
      value={users.data?.length}
      icon={Users}
      link={linkOptions({ to: '/users' })}
    />
  );
};

/** Content types, locales and (for user managers) admins, in one slim row. */
export const Stats = ({ modelCount }: StatsProps) => {
  const { t } = useTranslation();
  const locales = useLocales();
  const canSeeUsers = useHasGlobalPermission('users.manage');
  return (
    <div className={cn('grid gap-3 sm:grid-cols-2', canSeeUsers && 'sm:grid-cols-3')}>
      <Stat label={t('home.models')} value={modelCount} icon={Boxes} link={linkOptions({ to: '/content' })} />
      <Stat
        label={t('home.locales')}
        value={locales.data?.length}
        icon={Globe}
        link={linkOptions({ to: '/settings/locales' })}
      />
      {canSeeUsers ? <Admins /> : null}
    </div>
  );
};
