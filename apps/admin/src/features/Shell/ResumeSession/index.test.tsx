// @vitest-environment jsdom
import '@/test/dom';
import { ShapioApiError } from '@shapio/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { queryKeys } from '@/api/queryKeys';
import { useSessionStore } from '@/stores/session';
import { ResumeSession } from '.';

const mocks = vi.hoisted(() => ({ login: vi.fn(), me: vi.fn() }));

vi.mock('@/api/client', () => ({ adminApi: { auth: { login: mocks.login, me: mocks.me } } }));

const EMAIL = 'ada@example.com';
const ENTRY_KEY = ['content', 'article', 'e1'];

const renderPanel = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(ENTRY_KEY, { id: 'e1', title: 'Saved title' });
  render(
    <QueryClientProvider client={client}>
      <ResumeSession email={EMAIL} />
    </QueryClientProvider>,
  );
  return client;
};

describe('ResumeSession', () => {
  beforeEach(() => {
    mocks.login.mockReset();
    mocks.me.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    useSessionStore.setState({ signInRequired: true, resumed: 0, csrfToken: undefined });
  });

  it('signs the same admin in again in place, keeping what is cached', async () => {
    const user = userEvent.setup();
    mocks.login.mockResolvedValue({ user: { id: 'u1', email: EMAIL }, csrfToken: 'fresh' });
    mocks.me.mockResolvedValue({ user: { id: 'u1', email: EMAIL }, csrfToken: 'fresh' });
    const client = renderPanel();
    expect(screen.getByText('Your session has ended')).toBeTruthy();
    expect(screen.getByText(`Signing in as ${EMAIL}`)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
    await user.type(screen.getByLabelText('Password'), 'correct horse');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(useSessionStore.getState().signInRequired).toBe(false));
    expect(mocks.login).toHaveBeenCalledWith({ email: EMAIL, password: 'correct horse' });
    expect(useSessionStore.getState()).toMatchObject({ resumed: 1, csrfToken: 'fresh' });
    expect(client.getQueryData(ENTRY_KEY)).toEqual({ id: 'e1', title: 'Saved title' });
    expect(client.getQueryData(queryKeys.me)).toMatchObject({ user: { id: 'u1' } });
  });

  it('reports a wrong password inline and stays', async () => {
    const user = userEvent.setup();
    mocks.login.mockRejectedValue(
      new ShapioApiError(401, {
        error: { code: 'INVALID_CREDENTIALS', message: 'Wrong email or password.' },
      }),
    );
    renderPanel();
    await user.type(screen.getByLabelText('Password'), 'nope');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(useSessionStore.getState()).toMatchObject({ signInRequired: true, resumed: 0 });
  });
});
