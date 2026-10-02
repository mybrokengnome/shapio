import type { Role } from '@shapio/client';
import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { RowTitle } from '@/components/RowTitle';
import { TableCard } from '@/components/TableCard';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Table as TableRoot,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

type TableProps = { roles: Role[]; onEdit: (role: Role) => void; onDelete: (role: Role) => void };

export const Table = ({ roles, onEdit, onDelete }: TableProps) => {
  const { t } = useTranslation();
  return (
    <TableCard>
      <TableRoot>
        <TableHeader>
          <TableRow>
            <TableHead>{t('roles.name')}</TableHead>
            <TableHead>{t('roles.key')}</TableHead>
            <TableHead>{t('roles.kind')}</TableHead>
            <TableHead>{t('roles.permissions')}</TableHead>
            <TableHead>
              <span className="sr-only">{t('common.actions')}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {roles.map((role) => (
            <TableRow key={role.id}>
              <TableCell className="max-w-xs">
                <span className="flex items-center gap-2">
                  <RowTitle>{role.name}</RowTitle>
                  <Badge variant={role.isSystem ? 'secondary' : 'outline'}>
                    {role.isSystem ? t('roles.builtIn') : t('roles.custom')}
                  </Badge>
                </span>
                {role.description ? (
                  <span className="block truncate text-meta whitespace-normal text-muted-foreground">
                    {role.description}
                  </span>
                ) : null}
              </TableCell>
              <TableCell className="font-mono text-xs">{role.key}</TableCell>
              <TableCell>{role.kind === 'admin' ? t('roles.kindAdmin') : t('roles.kindDelivery')}</TableCell>
              <TableCell>{t('roles.permissionsCount', { count: role.permissions.length })}</TableCell>
              <TableCell className="text-right">
                {role.isSystem ? null : (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`${t('common.actions')}: ${role.name}`}
                      >
                        <MoreHorizontal aria-hidden="true" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => onEdit(role)}>
                        <Pencil aria-hidden="true" />
                        {t('common.edit')}
                      </DropdownMenuItem>
                      <DropdownMenuItem variant="destructive" onSelect={() => onDelete(role)}>
                        <Trash2 aria-hidden="true" />
                        {t('common.delete')}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </TableRoot>
    </TableCard>
  );
};
