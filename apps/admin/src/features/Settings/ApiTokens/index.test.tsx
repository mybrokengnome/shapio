// @vitest-environment jsdom
import '@/test/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { queryKeys } from '@/api/queryKeys';
import { ApiTokens } from '.';

const renderAs = (globalPermissions: string[]) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  queryClient.setQueryData(queryKeys.me, {
    globalPermissions,
    modelPermissions: {},
  });
  render(
    <QueryClientProvider client={queryClient}>
      <ApiTokens />
    </QueryClientProvider>,
  );
  return queryClient;
};

describe('Settings → API tokens', () => {
  it('without tokens.manage: the reason, no New token, and no token or role requests', () => {
    const queryClient = renderAs(['media.read']);
    expect(screen.getByText("You don't have access to this")).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'New token' })).toBeNull();
    expect(queryClient.getQueryCache().find({ queryKey: queryKeys.tokens })).toBeUndefined();
  });
});
