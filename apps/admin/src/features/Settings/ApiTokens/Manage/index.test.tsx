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

const token = (
  id: string,
  name: string,
  revokedAt: string | null = null,
  pin: Pick<ApiToken, 'pinnedSchemaVersion' | 'pinnedSchemaVersionAvailable'> = {
    pinnedSchemaVersion: null,
    pinnedSchemaVersionAvailable: true,
  },
) =>
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
    ...pin,
  }) as unknown as ApiToken;

const renderWith = (tokens: ApiToken[], sent: Array<{ tokenId: string; schemaVersion: number }> = []) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  queryClient.setQueryData(queryKeys.me, {
    site: { name: 'Main' },
    globalPermissions: [],
    modelPermissions: {},
  });
  queryClient.setQueryData(queryKeys.tokens, tokens);
  queryClient.setQueryData(queryKeys.develop.usage.schemaVersions, {
    tracking: true,
    principals: sent.map(({ tokenId, schemaVersion }) => ({
      principalKey: `token:${tokenId}`,
      schemaVersion,
      pinned: false,
      lastReadAt: '2026-10-02T00:00:00.000Z',
    })),
  });
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

  it('says whether a token is pinned to a schema version or sends one, and when a pin cannot be served', () => {
    renderWith(
      [
        token('a', 'Pinned build', null, { pinnedSchemaVersion: 3, pinnedSchemaVersionAvailable: true }),
        token('b', 'Overriding build', null, { pinnedSchemaVersion: 3, pinnedSchemaVersionAvailable: true }),
        token('c', 'Old pin', null, { pinnedSchemaVersion: 1, pinnedSchemaVersionAvailable: false }),
        token('d', 'Plain build'),
      ],
      [
        { tokenId: 'b', schemaVersion: 5 },
        { tokenId: 'd', schemaVersion: 4 },
      ],
    );
    expect(screen.getByText('Pinned to schema version 3')).toBeTruthy();
    expect(screen.getByText('Sends schema version 5')).toBeTruthy();
    expect(screen.getByText('Sends schema version 4')).toBeTruthy();
    expect(screen.getByText('Pinned to schema version 1')).toBeTruthy();
    expect(screen.getAllByText('Pinned version unavailable')).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: /^Edit: / })).toHaveLength(4);
  });
});
