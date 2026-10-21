import { useEffect, useRef, useState, type ChangeEvent } from 'react';

/**
 * Props for a text input bound to a node attribute (an image's alt text or caption). The input keeps its own
 * text while it has focus: the attribute comes back from the editor a render later, and an input controlled
 * by it directly would lose the caret to the end of the text after every keystroke. Changes made elsewhere
 * (undo, a suggested alt text, another user) show as soon as the input isn't being typed in.
 */
export const useNodeTextInput = (value: string, commit: (text: string) => void) => {
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) {
      setDraft(value);
    }
  }, [value]);

  return {
    value: draft,
    onChange: (event: ChangeEvent<HTMLInputElement>) => {
      setDraft(event.target.value);
      commit(event.target.value);
    },
    onFocus: () => {
      focused.current = true;
    },
    onBlur: () => {
      focused.current = false;
      setDraft(value);
    },
  };
};
