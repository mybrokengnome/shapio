// @vitest-environment jsdom
import '@/test/dom';
import type { ApiToken } from '@shapio/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { queryKeys } from '@/api/queryKeys';
import { Manage } from '.';

vi.mock('@/api/roles', () => ({
  useRoleNames: () => ({ names: new Map([['role-1', 'Delivery']]) }),
  useDraftRoleIds: () => ({ draftRoleIds: new Set<string>() }),
}));
vi.mock('../CreateSheet', () => ({ CreateSheet: () => null }));

const token = (id: string, name: string, revokedAt: string | null = null) =>
  ({
    id,
    name,
    tokenPrefix: 'shp_abc',
    roleId: 'role-1',
    siteId: 'site-1',
    expiresAt: null,
    lastUsedAt: null,
    revokedAt,
    creatorDisabled: false,
    createdAt: '2026-10-01T00:00:00.000Z',
  }) as unknown as ApiToken;

const renderWith = (tokens: ApiToken[]) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  queryClient.setQueryData(queryKeys.me, {
    site: { name: 'Main' },
    globalPermissions: [],
    modelPermissions: {},
  });
  queryClient.setQueryData(queryKeys.tokens, tokens);
  render(
    <QueryClientProvider client={queryClient}>
      <Manage />
    </QueryClientProvider>,
  );
};

describe('the API token list', () => {
  it('leaves revoked tokens out', () => {
    renderWith([token('a', 'Site build'), token('b', 'Old preview', '2026-10-10T00:00:00.000Z')]);
    expect(screen.getByText('Site build')).toBeTruthy();
    expect(screen.queryByText('Old preview')).toBeNull();
    expect(screen.getAllByRole('button', { name: /^Revoke: / })).toHaveLength(1);
    // The column is gone; expiry lives in Status.
    expect(screen.queryByRole('columnheader', { name: 'Expires' })).toBeNull();
  });

  it('shows the empty state when every token is revoked', () => {
    renderWith([token('b', 'Old preview', '2026-10-10T00:00:00.000Z')]);
    expect(screen.getByText('No API tokens yet.')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });
});
