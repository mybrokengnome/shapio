import type { EntryStatus } from '@shapio/client';
import { Link } from '@tanstack/react-router';
import { Copy, Eye, MoreHorizontal, Pencil, Send, SquarePen, Trash2, Undo2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { InlineConfirm } from '@/components/InlineConfirm';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/helpers/cn';
import type { usePlacePermissions } from '../hooks/usePlacePermissions';
import type { useRowActions } from '../hooks/useRowActions';

type RowActionsProps = {
  modelKey: string;
  entry: { id: string; status: EntryStatus };
  /** The entry's title, for the buttons' names and the confirmations. */
  label: string;
  locale: string | null;
  /** The locale's name for "Goes live in English"; null for models that aren't localized. */
  localeLabel: string | null;
  permissions: ReturnType<typeof usePlacePermissions>;
  actions: ReturnType<typeof useRowActions>;
  onPreview: (entryId: string) => void;
  /** Opens the row's quick edit (models with properties, with the update permission). */
  onQuickEdit?: () => void;
  /** DOM id of the menu button (focus returns there when the row's quick edit closes). */
  moreId?: string;
  /**
   * `inline`: Edit and Publish as buttons beside the menu, revealed on hover/focus from md up. `menu`: one
   * always-visible menu button holding every action (phone rows).
   */
  layout?: 'inline' | 'menu';
  className?: string;
};

type Confirming = 'publish' | 'delete';

/**
 * A row's quick actions: Edit, Publish or Unpublish (asks inline), Quick edit, Preview, Duplicate and Delete
 * (asks inline). Confirmations opened from the menu are anchored to the menu button.
 */
export const RowActions = ({
  modelKey,
  entry,
  label,
  locale,
  localeLabel,
  permissions,
  actions,
  onPreview,
  onQuickEdit,
  moreId,
  layout = 'inline',
  className,
}: RowActionsProps) => {
  const { t } = useTranslation();
  // The last confirmation asked for stays as `confirming` while it animates out, so its text doesn't change.
  const [confirming, setConfirming] = useState<Confirming>('delete');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const ask = (kind: Confirming) => {
    setConfirming(kind);
    setConfirmOpen(true);
  };
  // Confirmations and Quick edit move focus elsewhere (the popover, the first field): the menu must not
  // take it back to its button as it closes.
  const handingOff = useRef(false);
  const handOff = (run: () => void) => () => {
    handingOff.current = true;
    run();
  };
  const inline = layout === 'inline';
  const live = entry.status === 'published';
  const publishConfirm = {
    tone: 'default' as const,
    title: t(live ? 'place.actions.unpublishTitle' : 'place.actions.publishTitle', { entry: label }),
    description: localeLabel
      ? t(live ? 'place.actions.unpublishLocaleDescription' : 'place.actions.publishLocaleDescription', {
          locale: localeLabel,
        })
      : t(live ? 'place.actions.unpublishDescription' : 'place.actions.publishDescription'),
    confirmLabel: t(live ? 'content.actions.unpublish' : 'content.actions.publish'),
    pendingLabel: t(live ? 'place.actions.unpublishing' : 'place.actions.publishing'),
    onConfirm: () => (live ? actions.unpublish(entry.id, label) : actions.publish(entry.id, label)),
  };
  const deleteConfirm = {
    tone: 'danger' as const,
    title: t('place.actions.deleteTitle', { entry: label }),
    description: t('place.actions.deleteDescription'),
    confirmLabel: t('common.delete'),
    onConfirm: () => actions.remove(entry.id, label),
  };
  const editLink = {
    to: '/content/$modelKey/$entryId',
    params: { modelKey, entryId: entry.id },
    search: locale ? { locale } : {},
  } as const;
  const PublishIcon = live ? Undo2 : Send;
  return (
    <div
      className={cn(
        'flex items-center justify-end gap-0.5',
        inline &&
          'md:opacity-0 md:group-focus-within/row:opacity-100 md:group-hover/row:opacity-100 md:has-[[aria-expanded=true]]:opacity-100',
        className,
      )}
    >
      {inline ? (
        <Button asChild variant="ghost" size="icon-sm" aria-label={t('place.actions.edit', { entry: label })}>
          <Link {...editLink}>
            <Pencil aria-hidden="true" />
          </Link>
        </Button>
      ) : null}
      {inline && permissions.canPublish ? (
        <InlineConfirm
          {...publishConfirm}
          trigger={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t(live ? 'place.actions.unpublish' : 'place.actions.publish', { entry: label })}
            >
              <PublishIcon aria-hidden="true" />
            </Button>
          }
        />
      ) : null}
      <DropdownMenu>
        <InlineConfirm
          {...(confirming === 'publish' ? publishConfirm : deleteConfirm)}
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
        >
          <DropdownMenuTrigger asChild>
            <Button
              id={moreId}
              variant="ghost"
              size="icon-sm"
              aria-label={t('place.actions.more', { entry: label })}
            >
              <MoreHorizontal aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
        </InlineConfirm>
        <DropdownMenuContent
          align="end"
          onCloseAutoFocus={(event) => {
            if (handingOff.current) {
              handingOff.current = false;
              event.preventDefault();
            }
          }}
        >
          {inline ? null : (
            <DropdownMenuItem asChild>
              <Link {...editLink}>
                <Pencil aria-hidden="true" />
                {t('common.edit')}
              </Link>
            </DropdownMenuItem>
          )}
          {!inline && permissions.canPublish ? (
            <DropdownMenuItem onSelect={handOff(() => ask('publish'))}>
              <PublishIcon aria-hidden="true" />
              {t(live ? 'content.actions.unpublish' : 'content.actions.publish')}
            </DropdownMenuItem>
          ) : null}
          {onQuickEdit ? (
            <DropdownMenuItem onSelect={handOff(onQuickEdit)}>
              <SquarePen aria-hidden="true" />
              {t('place.actions.quickEdit')}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onSelect={() => onPreview(entry.id)}>
            <Eye aria-hidden="true" />
            {t('place.actions.preview')}
          </DropdownMenuItem>
          {permissions.canCreate ? (
            <DropdownMenuItem
              disabled={actions.duplicating}
              onSelect={() => actions.duplicate(entry.id, label)}
            >
              <Copy aria-hidden="true" />
              {t('content.actions.duplicate')}
            </DropdownMenuItem>
          ) : null}
          {permissions.canDelete ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={handOff(() => ask('delete'))}>
                <Trash2 aria-hidden="true" />
                {t('common.delete')}
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};
