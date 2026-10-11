import { ShapioApiError, type MeResponse } from '@shapio/client';
import { MutationObserver } from '@tanstack/react-query';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { meQueryOptions } from '@/api/auth';
import { queryKeys } from '@/api/queryKeys';
import { useSessionStore } from '@/stores/session';
import { createQueryClient } from './queryClient';

const mocks = vi.hoisted(() => ({ me: vi.fn() }));

vi.mock('@/api/client', () => ({ adminApi: { auth: { me: mocks.me } } }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const unauthorized = () =>
  new ShapioApiError(401, { error: { code: 'UNAUTHENTICATED', message: 'Not signed in' } });

const ME = { user: { id: 'u1', email: 'ada@example.com' } } as MeResponse;

/** Runs a mutation that fails with `error` through the client's mutation cache. */
const failMutation = async (client: ReturnType<typeof createQueryClient>, error: Error, key = ['entry']) => {
  const observer = new MutationObserver(client, {
    mutationKey: key,
    mutationFn: () => Promise.reject(error),
  });
  await observer.mutate().catch(() => undefined);
};

describe('the query client when the session ends', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    useSessionStore.setState({ unsavedEdits: 0, signInRequired: false, resumed: 0 });
  });
  afterEach(() => {
    vi.mocked(toast.error).mockReset();
    mocks.me.mockReset();
  });

  it('forgets the admin (the shell then leaves for Sign in) when nothing is unsaved', async () => {
    const client = createQueryClient();
    client.setQueryData(queryKeys.me, ME);
    await failMutation(client, unauthorized());
    expect(client.getQueryData(queryKeys.me)).toBeNull();
    expect(useSessionStore.getState().signInRequired).toBe(false);
    expect(toast.error).toHaveBeenCalled();
  });

  it('keeps the admin and asks for the password in place over unsaved edits, without a toast', async () => {
    const client = createQueryClient();
    client.setQueryData(queryKeys.me, ME);
    useSessionStore.getState().addUnsavedEdits();
    await failMutation(client, unauthorized());
    expect(client.getQueryData(queryKeys.me)).toEqual(ME);
    expect(useSessionStore.getState().signInRequired).toBe(true);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('stays in place while the sign-in is pending, even once the edits are gone', async () => {
    const client = createQueryClient();
    client.setQueryData(queryKeys.me, ME);
    useSessionStore.setState({ signInRequired: true });
    await failMutation(client, unauthorized());
    expect(client.getQueryData(queryKeys.me)).toEqual(ME);
  });

  it('leaves a 401 from a sign-in to the form (wrong password)', async () => {
    const client = createQueryClient();
    client.setQueryData(queryKeys.me, ME);
    useSessionStore.getState().addUnsavedEdits();
    await failMutation(client, unauthorized(), ['auth', 'resume']);
    expect(client.getQueryData(queryKeys.me)).toEqual(ME);
    expect(useSessionStore.getState().signInRequired).toBe(false);
  });

  it('keeps `me` when its refetch gets a 401 over unsaved edits, and answers null otherwise', async () => {
    const client = createQueryClient();
    mocks.me.mockResolvedValueOnce({ ...ME, csrfToken: 'token' });
    await client.fetchQuery(meQueryOptions);
    mocks.me.mockRejectedValue(unauthorized());
    useSessionStore.getState().addUnsavedEdits();
    await client.refetchQueries({ queryKey: queryKeys.me });
    expect(client.getQueryState(queryKeys.me)?.status).toBe('error');
    expect(client.getQueryData(queryKeys.me)).toMatchObject(ME);
    expect(useSessionStore.getState().signInRequired).toBe(true);

    useSessionStore.setState({ unsavedEdits: 0, signInRequired: false });
    await client.fetchQuery({ ...meQueryOptions, staleTime: 0 });
    expect(client.getQueryData(queryKeys.me)).toBeNull();
  });
});
