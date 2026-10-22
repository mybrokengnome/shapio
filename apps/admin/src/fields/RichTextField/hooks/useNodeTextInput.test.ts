// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import type { ChangeEvent, KeyboardEvent } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useNodeTextInput } from './useNodeTextInput';

const typed = (text: string) => ({ target: { value: text } }) as ChangeEvent<HTMLTextAreaElement>;
/** A key press and its `preventDefault` spy. */
const pressed = (name: string) => {
  const preventDefault = vi.fn();
  return {
    event: { key: name, preventDefault } as unknown as KeyboardEvent<HTMLTextAreaElement>,
    preventDefault,
  };
};

describe('useNodeTextInput', () => {
  it('keeps what was typed while the attribute catches up', () => {
    const commit = vi.fn();
    const { result, rerender } = renderHook(({ value }) => useNodeTextInput(value, commit), {
      initialProps: { value: 'Option Charts' },
    });
    act(() => result.current.onFocus());
    act(() => result.current.onChange(typed('Option XCharts')));
    expect(commit).toHaveBeenCalledWith('Option XCharts');
    // The editor hasn't rendered the new attribute yet: the input must not snap back to the old text.
    rerender({ value: 'Option Charts' });
    expect(result.current.value).toBe('Option XCharts');
    rerender({ value: 'Option XCharts' });
    expect(result.current.value).toBe('Option XCharts');
  });

  it('shows changes made elsewhere when the input is not being typed in', () => {
    const { result, rerender } = renderHook(({ value }) => useNodeTextInput(value, vi.fn()), {
      initialProps: { value: 'old' },
    });
    rerender({ value: 'suggested alt text' });
    expect(result.current.value).toBe('suggested alt text');
  });

  it('takes the attribute again when focus leaves', () => {
    const { result, rerender } = renderHook(({ value }) => useNodeTextInput(value, vi.fn()), {
      initialProps: { value: 'a' },
    });
    act(() => result.current.onFocus());
    act(() => result.current.onChange(typed('ab')));
    rerender({ value: 'ab' });
    act(() => result.current.onBlur());
    rerender({ value: 'undone' });
    expect(result.current.value).toBe('undone');
  });

  it('keeps the attribute on one line: Enter adds nothing and a pasted break becomes a space', () => {
    const commit = vi.fn();
    const { result } = renderHook(() => useNodeTextInput('', commit));
    const enter = pressed('Enter');
    result.current.onKeyDown(enter.event);
    expect(enter.preventDefault).toHaveBeenCalled();
    const letter = pressed('a');
    result.current.onKeyDown(letter.event);
    expect(letter.preventDefault).not.toHaveBeenCalled();
    act(() => result.current.onChange(typed('A dog \r\n  on a beach')));
    expect(commit).toHaveBeenCalledWith('A dog on a beach');
    expect(result.current.value).toBe('A dog on a beach');
  });
});
