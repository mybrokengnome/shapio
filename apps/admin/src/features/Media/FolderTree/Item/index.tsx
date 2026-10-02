import { Folder, FolderOpen } from 'lucide-react';
import { cn } from '@/helpers/cn';
import type { FolderNode } from '../../helpers/folderTree';
import type { FolderEdit } from '../../hooks/useFolderForm';
import { FOLDER_ROW_CLASSES } from '../constants';
import { EditRow } from '../EditRow';
import { Menu, type FolderActions } from '../Menu';

type ItemProps = {
  node: FolderNode;
  currentId: string | undefined;
  canWrite: boolean;
  canManage: boolean;
  actions: FolderActions;
  /** The inline row being edited anywhere in the tree. */
  editing: FolderEdit | undefined;
  onEditDone: (returnFocus: boolean) => void;
  onSelect: (id: string) => void;
};

/** A folder (button + actions menu, or its name being edited) and its subfolders, as a nested list. */
export const Item = ({
  node,
  currentId,
  canWrite,
  canManage,
  actions,
  editing,
  onEditDone,
  onSelect,
}: ItemProps) => {
  const current = node.id === currentId;
  const Icon = current ? FolderOpen : Folder;
  const renameEdit = editing?.mode === 'rename' && editing.folder.id === node.id ? editing : undefined;
  const childEdit = editing?.mode === 'create' && editing.parentId === node.id ? editing : undefined;
  return (
    <li>
      {renameEdit ? (
        <EditRow edit={renameEdit} onDone={onEditDone} />
      ) : (
        <div className="relative flex items-center">
          <button
            type="button"
            aria-current={current ? 'true' : undefined}
            onClick={() => onSelect(node.id)}
            className={cn(FOLDER_ROW_CLASSES, 'flex-1 pl-2.5', canWrite ? 'pr-9' : 'pr-2.5')}
          >
            <Icon aria-hidden="true" />
            <span className="truncate">{node.name}</span>
            <span className="ml-auto text-xs font-medium text-muted-foreground tabular-nums">
              {node.assetCount}
            </span>
          </button>
          {canWrite ? <Menu folder={node} canManage={canManage} actions={actions} /> : null}
        </div>
      )}
      {node.children.length > 0 || childEdit ? (
        <ul className="mt-0.5 ml-4 space-y-0.5 border-l pl-1.5">
          {childEdit ? (
            <li>
              <EditRow edit={childEdit} onDone={onEditDone} />
            </li>
          ) : null}
          {node.children.map((child) => (
            <Item
              key={child.id}
              node={child}
              currentId={currentId}
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
    </li>
  );
};
