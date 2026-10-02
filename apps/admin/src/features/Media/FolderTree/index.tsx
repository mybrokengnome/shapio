import type { MediaFolder } from '@shapio/client';
import { Images, Inbox } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Panel } from '@/components/Panel';
import { Skeleton } from '@/components/ui/skeleton';
import { ROOT_FOLDER } from '../constants';
import { buildFolderTree } from '../helpers/folderTree';
import type { FolderEdit } from '../hooks/useFolderForm';
import { EditRow } from './EditRow';
import { Item } from './Item';
import type { FolderActions } from './Menu';
import { ScopeButton } from './ScopeButton';

type FolderTreeProps = {
  folders: readonly MediaFolder[] | undefined;
  /** A folder ID, `root`, or undefined for every folder. */
  current: string | undefined;
  canWrite: boolean;
  canManage: boolean;
  actions: FolderActions;
  /** The folder name being typed in place (a new folder or a rename), if any. */
  editing: FolderEdit | undefined;
  onEditDone: (returnFocus: boolean) => void;
  onSelect: (folder: string | undefined) => void;
  className?: string;
};

/**
 * The folder rail: "All media", "Not in a folder", then every folder with rename / new subfolder / delete.
 * New top-level folders come from the page header; new and renamed folders are named in place.
 */
export const FolderTree = ({
  folders,
  current,
  canWrite,
  canManage,
  actions,
  editing,
  onEditDone,
  onSelect,
  className,
}: FolderTreeProps) => {
  const { t } = useTranslation();
  const tree = useMemo(() => buildFolderTree(folders ?? []), [folders]);
  const topLevelEdit = editing?.mode === 'create' && editing.parentId === null ? editing : undefined;
  return (
    <Panel title={t('media.folders.title')} flush className={className} bodyClassName="p-2">
      <nav aria-label={t('media.folders.title')} className="space-y-1">
        <ul className="space-y-0.5">
          <li>
            <ScopeButton
              current={current === undefined}
              icon={<Images aria-hidden="true" />}
              label={t('media.folders.all')}
              onClick={() => onSelect(undefined)}
            />
          </li>
          <li>
            <ScopeButton
              current={current === ROOT_FOLDER}
              icon={<Inbox aria-hidden="true" />}
              label={t('media.folders.unfiled')}
              onClick={() => onSelect(ROOT_FOLDER)}
            />
          </li>
        </ul>
        {folders === undefined ? (
          <Skeleton className="h-8 w-full" />
        ) : tree.length > 0 || topLevelEdit ? (
          <ul className="space-y-0.5 border-t pt-1">
            {topLevelEdit ? (
              <li>
                <EditRow edit={topLevelEdit} onDone={onEditDone} />
              </li>
            ) : null}
            {tree.map((node) => (
              <Item
                key={node.id}
                node={node}
                currentId={current}
                canWrite={canWrite}
                canManage={canManage}
                actions={actions}
                editing={editing}
                onEditDone={onEditDone}
                onSelect={onSelect}
              />
            ))}
          </ul>
        ) : null}
      </nav>
    </Panel>
  );
};
