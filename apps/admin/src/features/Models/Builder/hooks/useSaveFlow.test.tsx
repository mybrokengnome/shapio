// @vitest-environment jsdom
import '@/test/dom';
import type { SchemaChangeJob, SchemaChangeStatus } from '@shapio/client';
import { act, renderHook } from '@testing-library/react';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useDefinitionDraftStore } from '@/stores/definitionDraft';
import { model } from '../../../../../../../packages/schema/src/testing/fixtures';
import { useSaveFlow } from './useSaveFlow';

const mocks = vi.hoisted(() => ({
  ship: vi.fn(),
  latestChange: vi.fn(),
}));

vi.mock('@/api/schema', () => ({
  usePlanChange: () => ({ mutateAsync: vi.fn(), isPending: false }),
  fetchLatestDefinitionChange: mocks.latestChange,
}));
vi.mock('@/api/changeSets', () => ({
  useShipDraftNow: () => ({ mutateAsync: mocks.ship, reset: vi.fn(), isPending: false, error: null }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('@/helpers/reportError', () => ({ logError: vi.fn(), reportError: vi.fn() }));

const change = (status: SchemaChangeStatus): SchemaChangeJob => ({
  id: 'change-1',
  targetType: 'model',
  targetId: 'model-1',
  status,
  fromRevisionId: 'revision-1',
  toRevisionId: 'revision-2',
  jobId: 'job-1',
  error: null,
  createdAt: '2026-10-11T10:00:00.000Z',
  updatedAt: '2026-10-11T10:00:00.000Z',
  finishedAt: status === 'activated' ? '2026-10-11T10:00:01.000Z' : null,
});

const shipInBackground = async (status: SchemaChangeStatus) => {
  mocks.ship.mockResolvedValue({ id: 'set-1', status: 'shipping' });
  mocks.latestChange.mockResolvedValue(change(status));
  const { result } = renderHook(() => useSaveFlow('model', 'model-1', vi.fn()));
  await act(() => result.current.confirm({}));
  return result;
};

describe('useSaveFlow: a change shipped in the background', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useDefinitionDraftStore.getState().load('model', model(), 1);
  });

  it('follows the change while its checks run, and says it started', async () => {
    const result = await shipInBackground('running');
    expect(mocks.latestChange).toHaveBeenCalledWith('model', 'model-1');
    expect(result.current.runningChangeId).toBe('change-1');
    expect(toast.info).toHaveBeenCalledOnce();
  });

  it('follows a change that already ended before the builder looked, without saying it started', async () => {
    const result = await shipInBackground('activated');
    // ChangeProgress reads the final status on its first poll and the builder reloads the new version.
    expect(result.current.runningChangeId).toBe('change-1');
    expect(toast.info).not.toHaveBeenCalled();
  });
});
