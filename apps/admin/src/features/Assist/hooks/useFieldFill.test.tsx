// @vitest-environment jsdom
import '@/test/dom';
import {
  ShapioApiError,
  type AcceptContentOpsInput,
  type AcceptContentOpsResult,
  type FieldProposal,
} from '@shapio/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fillGroupsOf } from '../helpers/fillGroups';
import { useFieldFill } from './useFieldFill';

type Call = { runId: string; input: AcceptContentOpsInput };

const mocks = vi.hoisted(() => ({
  calls: [] as Call[],
  answer: vi.fn<(call: Call) => Promise<AcceptContentOpsResult>>(),
}));

vi.mock('@/api/assist', () => ({
  useAcceptContentOps: () => ({
    mutateAsync: (call: Call) => {
      mocks.calls.push(call);
      return mocks.answer(call);
    },
  }),
}));

const proposal = (entryId: string, fieldPath: string, value = 'Proposed'): FieldProposal => ({
  key: `entry:${entryId}:en:${fieldPath}`,
  entryId,
  modelKey: 'story',
  entryTitle: entryId,
  locale: 'en',
  fieldPath,
  fieldLabel: fieldPath.slice(1),
  fieldType: 'string',
  proposedValue: value,
  entryVersion: 3,
});

const [first, second] = fillGroupsOf([
  proposal('a', '/summary'),
  proposal('a', '/subtitle'),
  proposal('b', '/summary'),
]);
if (!first || !second) {
  throw new Error('two groups expected');
}

const saved = (entryId: string, changeSet: AcceptContentOpsResult['changeSet']): AcceptContentOpsResult => ({
  entryId,
  modelKey: 'story',
  locale: 'en',
  version: 4,
  changeSet,
});

const setup = () => {
  const queryClient = new QueryClient();
  return renderHook(() => useFieldFill('run-1'), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });
};

beforeEach(() => {
  mocks.calls.length = 0;
  mocks.answer.mockReset();
});

describe('useFieldFill', () => {
  it("sends one entry locale's values, edited or as proposed, leaving rejected fields out", async () => {
    mocks.answer.mockResolvedValue(saved('a', { added: true, id: 'set-1' }));
    const { result } = setup();
    act(() => result.current.setDraft('entry:a:en:/summary', 'Edited'));
    act(() => result.current.toggleRejected('entry:a:en:/subtitle'));
    act(() => result.current.accept(first));
    await waitFor(() => expect(result.current.outcomeOf(first)?.kind).toBe('saved'));
    expect(mocks.calls).toEqual([
      { runId: 'run-1', input: { items: [{ key: 'entry:a:en:/summary', value: 'Edited' }] } },
    ]);
    expect(result.current.changeSetId).toBe('set-1');
  });

  it('accepts one group after another, never two at once', async () => {
    let release: (value: AcceptContentOpsResult) => void = () => undefined;
    mocks.answer
      .mockImplementationOnce(() => new Promise((resolve) => (release = resolve)))
      .mockResolvedValueOnce(saved('b', { added: false, id: 'set-1', reason: 'neverPublished' }));
    const { result } = setup();
    act(() => result.current.accept(first));
    act(() => result.current.accept(second));
    await waitFor(() => expect(mocks.calls).toHaveLength(1));
    expect(result.current.isPending(second)).toBe(true);
    act(() => release(saved('a', { added: true, id: 'set-1' })));
    await waitFor(() => expect(result.current.outcomeOf(second)?.kind).toBe('saved'));
    expect(mocks.calls.map((call) => call.input.items[0]?.key)).toEqual([
      'entry:a:en:/summary',
      'entry:b:en:/summary',
    ]);
  });

  it('tells a field filled meanwhile and an invalid entry apart from other failures', async () => {
    mocks.answer
      .mockRejectedValueOnce(
        new ShapioApiError(409, { error: { code: 'ASSIST_FIELD_FILLED_MEANWHILE', message: 'filled' } }),
      )
      .mockRejectedValueOnce(
        new ShapioApiError(422, {
          error: {
            code: 'CONTENT_INVALID',
            message: 'invalid',
            details: { issues: [{ path: '/title', code: 'REQUIRED', message: 'Required' }] },
          },
        }),
      );
    const { result } = setup();
    act(() => result.current.accept(first));
    act(() => result.current.accept(second));
    await waitFor(() => expect(result.current.outcomeOf(second)).toBeDefined());
    expect(result.current.outcomeOf(first)).toEqual({ kind: 'filledMeanwhile' });
    expect(result.current.outcomeOf(second)).toMatchObject({ kind: 'invalid', issues: [{ path: '/title' }] });
  });

  it('tells a draft with unsaved autosaved work apart, and accepts again once it is saved', async () => {
    mocks.answer
      .mockRejectedValueOnce(
        new ShapioApiError(409, { error: { code: 'ASSIST_DRAFT_HAS_UNSAVED_WORK', message: 'unsaved' } }),
      )
      .mockResolvedValueOnce(saved('a', { added: true, id: 'set-1' }));
    const { result } = setup();
    act(() => result.current.accept(first));
    await waitFor(() => expect(result.current.outcomeOf(first)).toEqual({ kind: 'unsavedWork' }));
    expect(result.current.isPending(first)).toBe(false);
    act(() => result.current.accept(first));
    await waitFor(() => expect(result.current.outcomeOf(first)?.kind).toBe('saved'));
    expect(mocks.calls).toHaveLength(2);
  });

  it('refuses to send an emptied value', () => {
    const { result } = setup();
    act(() => result.current.setDraft('entry:b:en:/summary', '  '));
    expect(result.current.hasEmptyValue(second)).toBe(true);
  });
});
