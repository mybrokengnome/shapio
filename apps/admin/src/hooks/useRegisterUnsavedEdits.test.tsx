// @vitest-environment jsdom
import '@/test/dom';
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSessionStore } from '@/stores/session';
import { useDiscardGuard } from './useDiscardGuard';
import { useRegisterUnsavedEdits } from './useRegisterUnsavedEdits';

const count = () => useSessionStore.getState().unsavedEdits;

describe('useRegisterUnsavedEdits', () => {
  beforeEach(() => {
    useSessionStore.setState({ unsavedEdits: 0 });
  });

  it('counts a screen while it holds unsaved edits, and stops when they are saved or it unmounts', () => {
    const view = renderHook(({ dirty }) => useRegisterUnsavedEdits(dirty), {
      initialProps: { dirty: false },
    });
    expect(count()).toBe(0);
    view.rerender({ dirty: true });
    const other = renderHook(() => useRegisterUnsavedEdits(true));
    expect(count()).toBe(2);
    view.rerender({ dirty: false });
    expect(count()).toBe(1);
    other.unmount();
    expect(count()).toBe(0);
  });

  it('is fed by the discard guard unless it opts out', () => {
    const onOpenChange = vi.fn();
    const counted = renderHook(() => useDiscardGuard({ dirty: true, onOpenChange }));
    expect(count()).toBe(1);
    counted.unmount();
    renderHook(() => useDiscardGuard({ dirty: true, onOpenChange, registersEdits: false }));
    expect(count()).toBe(0);
  });
});
