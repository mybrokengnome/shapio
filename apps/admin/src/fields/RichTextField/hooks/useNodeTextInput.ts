import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';

type TextElement = HTMLInputElement | HTMLTextAreaElement;

/** The attribute is one line: a pasted line break becomes a space. */
const oneLine = (text: string) => text.replace(/\s*[\r\n]+\s*/g, ' ');

/**
 * Props for a text box bound to a one-line node attribute (an image's alt text or caption), shown in a
 * growing textarea so a long sentence stays readable. The box keeps its own text while it has focus: the
 * attribute comes back from the editor a render later, and a box controlled by it directly would lose the
 * caret to the end of the text after every keystroke. Changes made elsewhere (undo, a suggested alt text,
 * another user) show as soon as the box isn't being typed in. Enter never adds a line break.
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
    onChange: (event: ChangeEvent<TextElement>) => {
      const text = oneLine(event.target.value);
      setDraft(text);
      commit(text);
    },
    onKeyDown: (event: KeyboardEvent<TextElement>) => {
      if (event.key === 'Enter') {
        event.preventDefault();
      }
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
