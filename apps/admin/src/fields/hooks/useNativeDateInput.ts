import { useEffect, type FocusEvent, type RefObject, type SyntheticEvent } from 'react';
import { isUnparsed, unparsedText } from '../helpers/unparsed';
import { isDeepEqual } from '../helpers/values';

type NativeDateInputOptions = {
  /** The native input (the editor owns the ref and puts it on the input). */
  inputRef: RefObject<HTMLInputElement | null>;
  value: unknown;
  onChange: (value: unknown) => void;
  onBlur: () => void;
  /** The value of complete input text (`''` is never passed: an empty input is `null`). */
  parse: (text: string) => unknown;
};

/**
 * The wiring of a native date, time or date-time input. While a value is partly typed (`10/--/2026`) the
 * browser reports an empty value, and the typed text can't be read; `validity.badInput` says so. The form
 * then gets unparsed text with no text, so the field stays a change that Save, Create and Publish refuse,
 * instead of an empty value that would clear the saved one. Read on every change, key and blur (typing
 * into an empty input changes no value, so fires no change event). Clear empties the input's segments too,
 * and so does a value set from outside (reload, restore, discard), which React alone would not touch.
 */
export const useNativeDateInput = ({ inputRef, value, onChange, onBlur, parse }: NativeDateInputOptions) => {
  const incomplete = isUnparsed(value);
  useEffect(() => {
    // The form no longer holds the partial value, but the box still shows its segments: empty them.
    const input = inputRef.current;
    if (!incomplete && input?.validity.badInput) {
      input.value = '';
    }
  }, [inputRef, value, incomplete]);
  const report = (input: HTMLInputElement) => {
    const next = input.validity.badInput ? unparsedText('') : input.value === '' ? null : parse(input.value);
    if (!isDeepEqual(next, value ?? null)) {
      onChange(next);
    }
  };
  const read = (event: SyntheticEvent<HTMLInputElement>) => report(event.currentTarget);
  return {
    /** A partly typed value: the editor shows its own message. */
    incomplete,
    onChange: read,
    onKeyUp: read,
    onBlur: (event: FocusEvent<HTMLInputElement>) => {
      report(event.currentTarget);
      onBlur();
    },
    clear: () => {
      if (inputRef.current) {
        inputRef.current.value = '';
      }
      onChange(null);
    },
  };
};
