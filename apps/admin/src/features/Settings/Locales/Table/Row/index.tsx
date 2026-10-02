import type { Locale } from '@shapio/client';
import { MoreHorizontal, Pencil, Star, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { InlineConfirm } from '@/components/InlineConfirm';
import { RowTitle } from '@/components/RowTitle';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { TableCell, TableRow } from '@/components/ui/table';

type RowProps = {
  locale: Locale;
  /** The fallbacks delivery tries, the default locale last. */
  chain: readonly string[];
  canManage: boolean;
  onEdit: (locale: Locale) => void;
  onMakeDefault: (locale: Locale) => void;
  /** The first delete attempt; resolves once it's done or handed to the content acknowledgement. */
  onDelete: (locale: Locale) => Promise<unknown>;
};

/** One locale. Delete asks inline, anchored to the row's menu button. */
export const Row = ({ locale, chain, canManage, onEdit, onMakeDefault, onDelete }: RowProps) => {
  const { t } = useTranslation();
  const [deleting, setDeleting] = useState(false);
  return (
    <TableRow>
      <TableCell>
        <span className="flex items-center gap-2">
          <RowTitle>{locale.label}</RowTitle>
          {locale.isDefault ? <Badge variant="secondary">{t('locales.default')}</Badge> : null}
        </span>
      </TableCell>
      <TableCell className="font-mono text-xs">{locale.code}</TableCell>
      <TableCell className="font-mono text-xs">
        {chain.length > 0 ? chain.join(' → ') : t('common.none')}
      </TableCell>
      <TableCell className="text-right">
        {canManage ? (
          <DropdownMenu>
            <InlineConfirm
              tone="danger"
              open={deleting}
              onOpenChange={setDeleting}
              title={t('locales.deleteTitle', { label: locale.label })}
              description={t('locales.deleteDescription')}
              confirmLabel={t('common.delete')}
              pendingLabel={t('locales.deleting')}
              onConfirm={() => onDelete(locale)}
            >
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label={`${t('common.actions')}: ${locale.label}`}>
                  <MoreHorizontal aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
            </InlineConfirm>
            <DropdownMenuContent align="end" onCloseAutoFocus={(event) => deleting && event.preventDefault()}>
              <DropdownMenuItem onSelect={() => onEdit(locale)}>
                <Pencil aria-hidden="true" />
                {t('common.edit')}
              </DropdownMenuItem>
              {locale.isDefault ? null : (
                <>
                  <DropdownMenuItem onSelect={() => onMakeDefault(locale)}>
                    <Star aria-hidden="true" />
                    {t('locales.makeDefault')}
                  </DropdownMenuItem>
                  <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(true)}>
                    <Trash2 aria-hidden="true" />
                    {t('common.delete')}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </TableCell>
    </TableRow>
  );
};
