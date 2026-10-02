import type { AppRole } from '@shapio/client';
import { Link } from '@tanstack/react-router';
import { MoreHorizontal, SlidersHorizontal, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { InlineConfirm } from '@/components/InlineConfirm';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

type ActionsProps = {
  role: AppRole;
  /** Resolves once the role is deleted (the confirmation waits for it). */
  onDelete: (role: AppRole) => Promise<unknown>;
};

/** An app role's row menu; Delete asks inline, anchored to the menu button. */
export const Actions = ({ role, onDelete }: ActionsProps) => {
  const { t } = useTranslation();
  const [deleting, setDeleting] = useState(false);
  return (
    <DropdownMenu>
      <InlineConfirm
        tone="danger"
        open={deleting}
        onOpenChange={setDeleting}
        title={t('roles.deleteTitle', { name: role.name })}
        description={t('appRoles.deleteDescription')}
        confirmLabel={t('common.delete')}
        onConfirm={() => onDelete(role)}
      >
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={`${t('common.actions')}: ${role.name}`}>
            <MoreHorizontal aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
      </InlineConfirm>
      <DropdownMenuContent align="end" onCloseAutoFocus={(event) => deleting && event.preventDefault()}>
        <DropdownMenuItem asChild>
          <Link to="/settings/roles/app/$roleId" params={{ roleId: role.id }}>
            <SlidersHorizontal aria-hidden="true" />
            {t('appRoles.editPermissions')}
          </Link>
        </DropdownMenuItem>
        {role.isSystem ? null : (
          <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(true)}>
            <Trash2 aria-hidden="true" />
            {t('common.delete')}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
