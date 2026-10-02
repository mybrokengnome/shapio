import { createContext, useContext, useEffect } from 'react';
import type { BlockType } from '../RichTextField/canvas/blocks';

/** What the document's insertion points between canvas fields can ask a rich-text field to do. */
export type CanvasFieldHandle = {
  /** Adds a block at the start or end of the field's document and puts the cursor in it. */
  insertBlock: (type: BlockType, at: 'start' | 'end') => Promise<void>;
};

/** Rich-text canvas fields by value path; provided by the entry document's canvas. */
export type CanvasHandles = Map<string, CanvasFieldHandle>;

export const CanvasHandlesContext = createContext<CanvasHandles | null>(null);

export const useCanvasHandles = () => useContext(CanvasHandlesContext);

/** Registers a field's handle for as long as it is mounted (no-op outside a canvas). */
export const useRegisterCanvasHandle = (path: string, handle: CanvasFieldHandle | undefined) => {
  const handles = useCanvasHandles();
  useEffect(() => {
    if (!handles || !handle) {
      return undefined;
    }
    handles.set(path, handle);
    return () => {
      if (handles.get(path) === handle) {
        handles.delete(path);
      }
    };
  }, [handles, path, handle]);
};
