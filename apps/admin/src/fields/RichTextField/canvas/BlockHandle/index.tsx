import type { Editor } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import { GripVertical, Plus } from 'lucide-react';
import { useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useDeferredMenuAction } from '../../../hooks/useDeferredMenuAction';
import { BlockMenuItems } from '../BlockMenuItems';
import { startBlockDrag } from '../blockMove';
import type { BlockType } from '../blocks';

/** The hovered top-level block: where it starts and its offset from the top of the canvas field. */
export type HoveredBlock = { pos: number; top: number };

type BlockHandleProps = {
  editor: Editor;
  block: HoveredBlock;
  onInsert: (type: BlockType, pos: number) => void;
  /** The `+` menu is open: keep the handle where it is while the pointer is in the menu. */
  onMenuOpenChange: (open: boolean) => void;
};

/**
 * Beside the block under the pointer (desktop): `+` adds a block after it, the grip drags it (ProseMirror
 * moves it on drop) and selects it on click, so ⌥↑ / ⌥↓ can move it from the keyboard.
 */
export const BlockHandle = ({ editor, block, onInsert, onMenuOpenChange }: BlockHandleProps) => {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const menu = useDeferredMenuAction();
  const node = editor.state.doc.nodeAt(block.pos);
  if (!node) {
    return null;
  }
  const after = block.pos + node.nodeSize;
  const changeMenu = (open: boolean) => {
    setMenuOpen(open);
    onMenuOpenChange(open);
  };
  const selectBlock = () => {
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, block.pos)));
    editor.view.focus();
  };
  return (
    <div
      className="absolute top-(--handle-top) -left-16 hidden w-14 items-center justify-end gap-0.5 font-sans lg:flex"
      style={{ '--handle-top': `${block.top}px` } as CSSProperties}
      data-block-handle
    >
      <DropdownMenu open={menuOpen} onOpenChange={changeMenu}>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="text-muted-foreground"
                aria-label={t('entry.blocks.addAfter')}
              >
                <Plus aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>{t('entry.blocks.addAfter')}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="start" className="w-72" onCloseAutoFocus={menu.onCloseAutoFocus}>
          <BlockMenuItems onSelect={(type) => menu.defer(() => onInsert(type, after))} />
        </DropdownMenuContent>
      </DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            draggable
            className="cursor-grab text-muted-foreground active:cursor-grabbing"
            aria-label={t('entry.blocks.drag')}
            onClick={selectBlock}
            onDragStart={(event) => startBlockDrag(editor.view, block.pos, event.nativeEvent)}
          >
            <GripVertical aria-hidden="true" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t('entry.blocks.dragHint')}</TooltipContent>
      </Tooltip>
    </div>
  );
};
