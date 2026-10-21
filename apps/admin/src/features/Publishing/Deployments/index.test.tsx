// @vitest-environment jsdom
import '@/test/dom';
import type { DeploymentConnection, DeploymentConnectionSummary } from '@shapio/client';
import { render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Deployments } from '.';

const mocks = vi.hoisted(() => ({
  permissions: [] as string[],
  full: vi.fn(),
  summaries: vi.fn(),
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="/connection">{children}</a>,
  useNavigate: () => vi.fn(),
  useSearch: () => ({ cursor: undefined }),
}));
vi.mock('@/api/auth', () => ({ useMe: () => ({ data: { globalPermissions: mocks.permissions } }) }));
vi.mock('../Header', () => ({
  Header: ({ actions }: { actions?: ReactNode }) => <header>{actions}</header>,
}));
vi.mock('./RunsList', () => ({ RunsList: () => null }));
vi.mock('./CreateSheet', () => ({ CreateSheet: () => null }));
vi.mock('@/api/deployments', () => {
  const idle = { isPending: false, mutate: vi.fn(), mutateAsync: vi.fn(), data: undefined };
  return {
    useDeploymentConnections: (enabled: boolean) => mocks.full(enabled) as unknown,
    useDeploymentConnectionSummaries: (enabled: boolean) => mocks.summaries(enabled) as unknown,
    useTestDeploymentConnection: () => idle,
    useDeleteDeploymentConnection: () => idle,
    useTriggerDeployment: () => idle,
  };
});

const summary: DeploymentConnectionSummary = {
  id: 'c1',
  name: 'Marketing site',
  provider: 'generic_webhook',
  enabled: true,
  triggerPolicy: ['manual'],
  secretsUnreadable: false,
  latestRun: null,
  currentRun: null,
};
const full = {
  ...summary,
  settings: { url: 'https://build.example.com/hook' },
  callbackUrl: 'https://cms.example.com/callback',
} as unknown as DeploymentConnection;

const loaded = (data: unknown) => ({ isPending: false, isError: false, isSuccess: true, data });
const idleQuery = { isPending: true, isError: false, isSuccess: false, data: undefined };

describe('Deployments page', () => {
  beforeEach(() => {
    mocks.full.mockReset().mockImplementation((enabled: boolean) => (enabled ? loaded([full]) : idleQuery));
    mocks.summaries
      .mockReset()
      .mockImplementation((enabled: boolean) => (enabled ? loaded([summary]) : idleQuery));
  });

  it('shows someone who may only trigger each connection with Deploy now, from the summaries', () => {
    mocks.permissions = ['deployments.trigger'];
    render(<Deployments />);
    expect(mocks.full).toHaveBeenLastCalledWith(false);
    expect(mocks.summaries).toHaveBeenLastCalledWith(true);
    const card = screen.getByRole('heading', { name: 'Marketing site' }).closest('section') as HTMLElement;
    expect(within(card).getByRole('button', { name: 'Deploy now' })).toBeTruthy();
    expect(within(card).queryByRole('link', { name: 'Open' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'New connection' })).toBeNull();
    expect(document.body.textContent).not.toContain('https://');
  });

  it('shows a manager the full connections, Open and New connection, as before', () => {
    mocks.permissions = ['deployments.manage', 'deployments.trigger'];
    render(<Deployments />);
    expect(mocks.full).toHaveBeenLastCalledWith(true);
    expect(mocks.summaries).toHaveBeenLastCalledWith(false);
    expect(screen.getByRole('link', { name: 'Open' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'New connection' })).toBeTruthy();
  });

  it('shows someone who may neither no connections and requests none', () => {
    mocks.permissions = [];
    render(<Deployments />);
    expect(mocks.full).toHaveBeenLastCalledWith(false);
    expect(mocks.summaries).toHaveBeenLastCalledWith(false);
    expect(screen.queryByRole('heading', { name: 'Marketing site' })).toBeNull();
  });
});
