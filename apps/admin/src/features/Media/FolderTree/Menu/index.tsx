import type { MediaFolder } from '@shapio/client';
import { FolderPlus, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { useRef } from 'react';
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

export type FolderActions = {
  onCreate: (parentId: string | null) => void;
  onRename: (folder: MediaFolder) => void;
  /** The folder whose delete confirmation is open. */
  deletingId: string | undefined;
  onDeleteOpenChange: (folder: MediaFolder, open: boolean) => void;
  onDelete: (folder: MediaFolder) => Promise<unknown>;
};

type MenuProps = { folder: MediaFolder; canManage: boolean; actions: FolderActions };

/**
 * A folder's "…" menu: new subfolder and rename (an inline row takes focus), delete (confirmed in a popover
 * anchored to this button).
 */
export const Menu = ({ folder, canManage, actions }: MenuProps) => {
  const { t } = useTranslation();
  // A menu item hands focus to the inline row or the delete confirmation instead of the menu button.
  const handingOff = useRef(false);
  const handOff = (action: () => void) => () => {
    handingOff.current = true;
    action();
  };
  return (
    <DropdownMenu>
      <InlineConfirm
        tone="danger"
        open={actions.deletingId === folder.id}
        onOpenChange={(open) => actions.onDeleteOpenChange(folder, open)}
        title={t('media.folders.deleteTitle', { name: folder.name })}
        description={t('media.folders.deleteDescription')}
        confirmLabel={t('common.delete')}
        onConfirm={() => actions.onDelete(folder)}
      >
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={t('media.folders.actions', { name: folder.name })}
            className="absolute right-1.5"
            data-folder-menu={folder.id}
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
        <DropdownMenuItem onSelect={handOff(() => actions.onCreate(folder.id))}>
          <FolderPlus aria-hidden="true" />
          {t('media.folders.newSubfolder')}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={handOff(() => actions.onRename(folder))}>
          <Pencil aria-hidden="true" />
          {t('media.folders.rename')}
        </DropdownMenuItem>
        {canManage ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onSelect={handOff(() => actions.onDeleteOpenChange(folder, true))}
            >
              <Trash2 aria-hidden="true" />
              {t('common.delete')}
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
