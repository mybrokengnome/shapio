import type { AppRole } from '@shapio/client';
import { Link } from '@tanstack/react-router';
import { BookOpen } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { RowTitle } from '@/components/RowTitle';
import { TableCard } from '@/components/TableCard';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table as TableRoot,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { readsAllModels } from '../hooks/useGrantReadAll';
import { Actions } from './Actions';

type TableProps = {
  roles: AppRole[];
  onDelete: (role: AppRole) => Promise<unknown>;
  /** The one-click preset offered on built-in roles that don't read every model yet. */
  onGrantReadAll: (role: AppRole) => void;
  pendingRoleId: string | undefined;
};

const BUILT_IN_HOLDER_KEYS = {
  public: 'appRoles.holdersPublic',
  authenticated: 'appRoles.holdersAuthenticated',
} as const;

const builtInHolderKey = (key: string) =>
  Object.hasOwn(BUILT_IN_HOLDER_KEYS, key)
    ? BUILT_IN_HOLDER_KEYS[key as keyof typeof BUILT_IN_HOLDER_KEYS]
    : undefined;

export const Table = ({ roles, onDelete, onGrantReadAll, pendingRoleId }: TableProps) => {
  const { t } = useTranslation();
  return (
    <TableCard>
      <TableRoot>
        <TableHeader>
          <TableRow>
            <TableHead>{t('roles.name')}</TableHead>
            <TableHead>{t('roles.key')}</TableHead>
            <TableHead>{t('appRoles.heldBy')}</TableHead>
            <TableHead>{t('roles.permissions')}</TableHead>
            <TableHead>
              <span className="sr-only">{t('common.actions')}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {roles.map((role) => {
            const holderKey = role.isSystem ? builtInHolderKey(role.key) : undefined;
            return (
              <TableRow key={role.id}>
                <TableCell className="max-w-xs">
                  <span className="flex items-center gap-2">
                    <RowTitle asChild>
                      <Link to="/settings/roles/app/$roleId" params={{ roleId: role.id }}>
                        {role.name}
                      </Link>
                    </RowTitle>
                    <Badge variant={role.isSystem ? 'secondary' : 'outline'}>
                      {role.isSystem ? t('roles.builtIn') : t('roles.custom')}
                    </Badge>
                  </span>
                  {role.description ? (
                    <span className="block text-meta whitespace-normal text-muted-foreground">
                      {role.description}
                    </span>
                  ) : null}
                </TableCell>
                <TableCell className="font-mono text-xs">{role.key}</TableCell>
                <TableCell>
                  {holderKey ? t(holderKey) : t('appRoles.userCount', { count: role.userCount })}
                </TableCell>
                <TableCell>
                  <span className="flex flex-wrap items-center gap-2">
                    {t('roles.permissionsCount', { count: role.permissions.length })}
                    {role.isSystem && !readsAllModels(role) ? (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={pendingRoleId === role.id}
                        aria-label={`${t('appRoles.grantReadAll')}: ${role.name}`}
                        onClick={() => onGrantReadAll(role)}
                      >
                        <BookOpen aria-hidden="true" />
                        {t('appRoles.grantReadAll')}
                      </Button>
                    ) : null}
                  </span>
                </TableCell>
                <TableCell className="text-right">
                  <Actions role={role} onDelete={onDelete} />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </TableRoot>
    </TableCard>
  );
};
