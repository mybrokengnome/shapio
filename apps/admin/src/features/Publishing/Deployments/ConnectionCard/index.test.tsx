// @vitest-environment jsdom
import '@/test/dom';
import type { DeploymentConnection } from '@shapio/client';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectionCard } from '.';

const mocks = vi.hoisted(() => ({ trigger: vi.fn() }));

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="/connection">{children}</a>,
  useNavigate: () => vi.fn(),
}));
vi.mock('@/api/auth', () => ({
  useMe: () => ({ data: { globalPermissions: ['deployments.manage', 'deployments.trigger'] } }),
}));
vi.mock('@/api/deployments', () => {
  const idle = { isPending: false, mutate: vi.fn(), mutateAsync: vi.fn(), data: undefined };
  return {
    useTestDeploymentConnection: () => idle,
    useDeleteDeploymentConnection: () => idle,
    useTriggerDeployment: () => ({ ...idle, mutate: mocks.trigger }),
  };
});

const connection = (overrides: Partial<DeploymentConnection> = {}): DeploymentConnection => ({
  id: 'c1',
  name: 'Marketing site',
  provider: 'generic_webhook',
  settings: { url: 'https://build.example.com' },
  secrets: { signingSecret: { set: true, envVar: null } },
  previewUrlTemplate: null,
  deliveryRoleId: null,
  triggerPolicy: ['manual'],
  debounceSeconds: 30,
  allowPrivateNetwork: false,
  enabled: true,
  callbackUrl: 'https://cms.example.com/callback',
  latestRun: null,
  currentRun: null,
  createdBy: null,
  createdAt: '2026-10-08T00:00:00.000Z',
  updatedAt: '2026-10-08T00:00:00.000Z',
  version: 1,
  secretsUnreadable: false,
  ...overrides,
});

const WARNING = "Secret can't be read. Enter it again.";
const deployNow = () => screen.getByRole<HTMLButtonElement>('button', { name: 'Deploy now' });

describe('ConnectionCard', () => {
  beforeEach(() => {
    mocks.trigger.mockReset();
  });

  it('deploys a readable, enabled connection without a warning', async () => {
    render(<ConnectionCard connection={connection()} />);
    expect(screen.queryByText(WARNING)).toBeNull();
    expect(deployNow().disabled).toBe(false);
    await userEvent.click(deployNow());
    expect(mocks.trigger).toHaveBeenCalledWith('c1', expect.anything());
  });

  it('warns and disables Deploy now when the stored secret cannot be read', () => {
    render(<ConnectionCard connection={connection({ secretsUnreadable: true })} />);
    const warning = screen.getByText(WARNING).closest('[data-slot="status-chip"]');
    expect(warning?.getAttribute('data-tone')).toBe('warning');
    expect(deployNow().disabled).toBe(true);
    // Open stays available: the secret is entered again on the connection page.
    expect(screen.getByRole('link', { name: 'Open' })).toBeDefined();
  });

  it('keeps Deploy now disabled for a disabled connection', () => {
    render(<ConnectionCard connection={connection({ enabled: false })} />);
    expect(screen.queryByText(WARNING)).toBeNull();
    expect(deployNow().disabled).toBe(true);
  });
});
