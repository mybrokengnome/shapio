// @vitest-environment jsdom
import '@/test/dom';
import type { Webhook } from '@shapio/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { View } from '.';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="/webhooks">{children}</a>,
  linkOptions: (options: unknown) => options,
  useNavigate: () => vi.fn(),
}));
vi.mock('@/api/webhooks', () => {
  const idle = { isPending: false, mutate: vi.fn(), mutateAsync: vi.fn(), data: undefined };
  return {
    useTestWebhook: () => idle,
    useUpdateWebhook: () => idle,
    useRotateWebhookSecret: () => idle,
    useDeleteWebhook: () => idle,
  };
});
// The delivery log and the settings form load their own data; this test is about the header.
vi.mock('../Deliveries', () => ({ Deliveries: () => null }));
vi.mock('../EditForm', () => ({ EditForm: () => null }));

const webhook = (overrides: Partial<Webhook> = {}): Webhook => ({
  id: 'w1',
  name: 'Search index',
  url: 'https://hooks.example.com/shapio',
  events: ['entry.*'],
  enabled: true,
  allowPrivateNetwork: false,
  maxAttempts: 5,
  site: { id: 's1', key: 'default' },
  lastDelivery: null,
  createdBy: null,
  createdAt: '2026-10-11T00:00:00.000Z',
  updatedAt: '2026-10-11T00:00:00.000Z',
  version: 1,
  secretsUnreadable: false,
  ...overrides,
});

const WARNING = "Secret can't be read. Rotate it.";
const button = (name: string) => screen.getByRole<HTMLButtonElement>('button', { name });

const renderView = (value: Webhook) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <View webhook={value} />
    </QueryClientProvider>,
  );

describe('webhook View', () => {
  it('sends tests from a readable webhook without a warning', () => {
    renderView(webhook());
    expect(screen.queryByText(WARNING)).toBeNull();
    expect(button('Send test').disabled).toBe(false);
    expect(button('Rotate secret').dataset.variant).toBe('outline');
  });

  it('warns, disables Send test, and makes Rotate the main action when the secret cannot be read', () => {
    renderView(webhook({ secretsUnreadable: true }));
    const warning = screen.getByText(WARNING).closest('[data-slot="status-chip"]');
    expect(warning?.getAttribute('data-tone')).toBe('warning');
    expect(button('Send test').disabled).toBe(true);
    expect(button('Rotate secret').disabled).toBe(false);
    expect(button('Rotate secret').dataset.variant).toBe('default');
  });
});
