// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import type { ChangeEvent } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useNodeTextInput } from './useNodeTextInput';

const typed = (text: string) => ({ target: { value: text } }) as ChangeEvent<HTMLInputElement>;

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
});
