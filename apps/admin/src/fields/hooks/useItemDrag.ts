import { useState, type DragEvent } from 'react';

const DRAG_TYPE = 'application/x-shapio-item';

/**
 * Native HTML5 drag to reorder the items of one list (component blocks in the canvas). Only drags that
 * started in this list are accepted, so files or other lists' items never drop here. ⌥↑ / ⌥↓ and the move
 * buttons do the same from the keyboard.
 */
export const useItemDrag = (move: (from: number, to: number) => void) => {
  const [from, setFrom] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const reset = () => {
    setFrom(null);
    setOver(null);
  };
  return {
    handleProps: (index: number) => ({
      draggable: true,
      onDragStart: (event: DragEvent) => {
        setFrom(index);
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData(DRAG_TYPE, String(index));
        const item = (event.currentTarget as HTMLElement).closest('li');
        if (item) {
          event.dataTransfer.setDragImage(item, 16, 16);
        }
      },
      onDragEnd: reset,
    }),
    targetProps: (index: number) => ({
      onDragOver: (event: DragEvent) => {
        if (from === null || !event.dataTransfer.types.includes(DRAG_TYPE)) {
          return;
        }
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        setOver(index);
      },
      onDrop: (event: DragEvent) => {
        if (from === null) {
          return;
        }
        event.preventDefault();
        if (from !== index) {
          move(from, index);
        }
        reset();
      },
    }),
    /** Where the dragged item would land: before (moving up) or after (moving down) this item. */
    dropSide: (index: number): 'before' | 'after' | undefined =>
      from === null || over !== index || from === index ? undefined : from > index ? 'before' : 'after',
  };
};
