// @vitest-environment jsdom
import '@/test/dom';
import type { DraftState } from '@shapio/client';
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useRemoteDraftChange } from './useRemoteDraftChange';

const draft = (locale: string, version: number, savedBy: DraftState['savedBy'] = null): DraftState => ({
  locale,
  version,
  savedAt: '2026-10-11T10:00:00.000Z',
  savedBy,
});

type Props = {
  drafts: DraftState[];
  shownVersion: number | undefined;
  dirty: boolean;
  busy: boolean;
  conflict: string | undefined;
};

const setup = (initial: Partial<Props> = {}) => {
  const onConflict = vi.fn();
  const initialProps: Props = {
    drafts: [],
    shownVersion: 3,
    dirty: false,
    busy: false,
    conflict: undefined,
    ...initial,
  };
  const { result, rerender } = renderHook(
    (props: Props) => useRemoteDraftChange({ ...props, locale: 'en', onConflict }),
    { initialProps },
  );
  return { result, rerender: (next: Partial<Props>) => rerender({ ...initialProps, ...next }), onConflict };
};

describe('useRemoteDraftChange', () => {
  it('stays quiet while the server has the version this tab shows', () => {
    const { result, onConflict } = setup({ drafts: [draft('en', 3), draft('fr', 9)] });
    expect(result.current.remoteChange).toBeNull();
    expect(onConflict).not.toHaveBeenCalled();
  });

  it("names who moved this locale's draft when the tab has no edits", () => {
    const savedBy = { name: 'Ana', you: false };
    const { result, onConflict } = setup({ drafts: [draft('fr', 3), draft('en', 4, savedBy)] });
    expect(result.current.remoteChange).toEqual({ savedAt: '2026-10-11T10:00:00.000Z', savedBy });
    expect(onConflict).not.toHaveBeenCalled();
  });

  it('raises the conflict banner once, instead of the notice, when the tab has unsaved edits', () => {
    const { result, rerender, onConflict } = setup({ drafts: [draft('en', 4)], dirty: true });
    expect(result.current.remoteChange).toBeNull();
    expect(onConflict).toHaveBeenCalledExactlyOnceWith('CONTENT_VERSION_CONFLICT');
    rerender({ conflict: 'CONTENT_VERSION_CONFLICT' });
    expect(onConflict).toHaveBeenCalledOnce();
  });

  it('turns the notice into the banner when editing starts on a moved draft', () => {
    const { result, rerender, onConflict } = setup({ drafts: [draft('en', 4)] });
    expect(result.current.remoteChange).not.toBeNull();
    rerender({ dirty: true });
    expect(onConflict).toHaveBeenCalledWith('CONTENT_VERSION_CONFLICT');
  });

  it("ignores the tab's own save in flight, and the notice goes once the tab has that version", () => {
    const { result, rerender, onConflict } = setup({
      drafts: [draft('en', 4)],
      dirty: true,
      busy: true,
    });
    expect(result.current.remoteChange).toBeNull();
    expect(onConflict).not.toHaveBeenCalled();
    rerender({ shownVersion: 4, dirty: false, busy: false });
    expect(result.current.remoteChange).toBeNull();
    expect(onConflict).not.toHaveBeenCalled();
  });

  it('never treats an older version from a late heartbeat as a change', () => {
    const { result } = setup({ drafts: [draft('en', 2)] });
    expect(result.current.remoteChange).toBeNull();
  });
});
