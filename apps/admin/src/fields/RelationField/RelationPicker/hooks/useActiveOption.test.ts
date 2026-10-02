// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useActiveOption } from './useActiveOption';

describe('useActiveOption', () => {
  it('starts with nothing active; ↓ goes to the first option and ↑ to the last', () => {
    const down = renderHook(() => useActiveOption(['a', 'b', 'c']));
    expect(down.result.current.activeId).toBeUndefined();
    act(() => down.result.current.move(1));
    expect(down.result.current.activeId).toBe('a');
    const up = renderHook(() => useActiveOption(['a', 'b', 'c']));
    act(() => up.result.current.move(-1));
    expect(up.result.current.activeId).toBe('c');
  });

  it('stops at both ends', () => {
    const { result } = renderHook(() => useActiveOption(['a', 'b']));
    act(() => result.current.move(1));
    act(() => result.current.move(1));
    act(() => result.current.move(1));
    expect(result.current.activeId).toBe('b');
    act(() => result.current.move(-1));
    act(() => result.current.move(-1));
    expect(result.current.activeId).toBe('a');
  });

  it('jumps to the first and last option', () => {
    const { result } = renderHook(() => useActiveOption(['a', 'b', 'c']));
    act(() => result.current.last());
    expect(result.current.activeId).toBe('c');
    act(() => result.current.first());
    expect(result.current.activeId).toBe('a');
  });

  it('keeps the active option across new results and clears it when it goes away', () => {
    const { result, rerender } = renderHook(({ ids }) => useActiveOption(ids), {
      initialProps: { ids: ['a', 'b'] },
    });
    act(() => result.current.setActiveId('b'));
    rerender({ ids: ['b', 'c'] });
    expect(result.current.activeId).toBe('b');
    rerender({ ids: ['c'] });
    expect(result.current.activeId).toBeUndefined();
  });

  it('does nothing without options', () => {
    const { result } = renderHook(() => useActiveOption([]));
    act(() => result.current.move(1));
    expect(result.current.activeId).toBeUndefined();
  });
});
