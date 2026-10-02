import { Folder, FolderInput, Inbox } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMediaFolders } from '@/api/media';
import { FormError } from '@/components/FormError';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import { moveFocusWithArrows } from '../helpers/arrowFocus';
import { buildFolderTree, flattenFolderTree } from '../helpers/folderTree';
import { useMoveToFolder } from '../hooks/useMoveToFolder';
import { Choice } from './Choice';

type MovePopoverProps = { assetIds: readonly string[]; onMoved: () => void };

/**
 * "Move to…" for the selected files: a popover with the folder tree; choosing a folder moves them at once.
 * Up and Down move through the folders.
 */
export const MovePopover = ({ assetIds, onMoved }: MovePopoverProps) => {
  const { t } = useTranslation();
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const folders = useMediaFolders();
  const choices = useMemo(() => flattenFolderTree(buildFolderTree(folders.data ?? [])), [folders.data]);
  const move = useMoveToFolder(assetIds, () => {
    setOpen(false);
    onMoved();
  });
  const changeOpen = (next: boolean) => {
    if (move.pending) {
      return;
    }
    if (next) {
      move.reset();
    }
    setOpen(next);
  };
  return (
    <Popover open={open} onOpenChange={changeOpen} modal>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline">
          <FolderInput aria-hidden="true" />
          {t('media.move.action')}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" aria-labelledby={titleId} className="w-72 space-y-2 p-2">
        <p id={titleId} className="px-2.5 pt-1 text-sm font-semibold">
          {t('media.move.title', { count: assetIds.length })}
        </p>
        <ul className="max-h-72 space-y-0.5 overflow-y-auto" onKeyDown={moveFocusWithArrows}>
          <Choice
            icon={<Inbox aria-hidden="true" />}
            label={t('media.folders.none')}
            depth={0}
            pending={move.target === null}
            disabled={move.pending}
            onClick={() => void move.moveTo(null)}
          />
          {choices.map((folder) => (
            <Choice
              key={folder.id}
              icon={<Folder aria-hidden="true" />}
              label={folder.name}
              depth={folder.depth}
              pending={move.target === folder.id}
              disabled={move.pending}
              onClick={() => void move.moveTo(folder.id)}
            />
          ))}
        </ul>
        {folders.isPending ? <Skeleton className="h-8 w-full" /> : null}
        <FormError error={move.error} />
      </PopoverContent>
    </Popover>
  );
};
