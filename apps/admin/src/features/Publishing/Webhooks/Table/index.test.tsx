// @vitest-environment jsdom
import '@/test/dom';
import type { Webhook } from '@shapio/client';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Table } from '.';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="/webhook">{children}</a>,
}));

const webhook = (id: string, name: string, secretsUnreadable: boolean): Webhook => ({
  id,
  name,
  url: `https://hooks.example.com/${id}`,
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
  secretsUnreadable,
});

describe('webhooks Table', () => {
  it('flags only the webhook whose secret cannot be read', () => {
    render(<Table webhooks={[webhook('w1', 'Healthy', false), webhook('w2', 'Broken', true)]} />);
    const warnings = screen.getAllByText("Secret can't be read. Rotate it.");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.closest('tr')?.textContent).toContain('Broken');
  });
});
