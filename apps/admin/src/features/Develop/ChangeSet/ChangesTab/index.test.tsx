// @vitest-environment jsdom
import '@/test/dom';
import type { ChangeSet, ChangeSetReview } from '@shapio/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { Banners } from '../Banners';
import type { ShipFlow } from '../hooks/useShipFlow';
import { ChangesTab } from '.';

const SHIPPED_SET: ChangeSet = {
  id: '00000000-0000-4000-8000-000000000001',
  title: 'Launch',
  description: '',
  status: 'shipped',
  shipPhase: null,
  source: 'manual',
  restoreOfSnapshot: null,
  scheduledFor: null,
  deploymentConnectionId: null,
  deploymentRunId: null,
  shippedAt: new Date().toISOString(),
  shippedSnapshot: 22,
  schemaVersionAfter: 4,
  error: null,
  entryItemCount: 1,
  schemaItemCount: 0,
  createdBy: { type: 'admin', id: 'a1', name: 'Ada Owner' },
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  version: 3,
  approval: {
    status: 'none',
    note: '',
    round: 0,
    requestedBy: null,
    requestedAt: null,
    outdated: false,
    approvedAtShip: false,
    eligible: false,
    eligibleReason: null,
    stage: null,
    workflow: null,
    signoffs: [],
    approvedBy: null,
    approvedAt: null,
  },
  items: [],
  shippedBy: { type: 'admin', id: 'a2', name: 'Grace Shipper' },
};

const reviewOf = (changeSet: ChangeSet): ChangeSetReview => ({
  changeSet,
  entries: [
    {
      itemId: '00000000-0000-4000-8000-000000000002',
      entryId: '00000000-0000-4000-8000-000000000003',
      modelId: 'm1',
      modelKey: 'article',
      title: 'Writer edited title',
      locale: 'en',
      action: 'publish',
      sourceRevisionId: null,
      draftVersion: null,
      liveState: 'published',
      fields: [
        {
          fieldId: 'f1',
          apiKey: 'title',
          label: 'Title',
          type: 'string',
          before: 'Old title',
          after: 'Writer edited title',
          summary: { before: 'Old title', after: 'Writer edited title' },
        },
      ],
      issues: [],
    },
  ],
  schema: [],
  notRestorable: [],
  consumers: [],
  usageDays: 7,
  checks: { breaking: false, destructive: false, blocking: [], warnings: [] },
  notices: [],
});

const renderInRouter = (node: ReactNode) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createRouter({
    routeTree: createRootRoute({ component: () => node }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
};

describe('a shipped change set', () => {
  it('lists what it shipped as before and shipped values, without live-state chips or remove buttons', async () => {
    renderInRouter(<ChangesTab review={reviewOf(SHIPPED_SET)} editable={false} />);
    expect(await screen.findByRole('columnheader', { name: 'Before' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Shipped' })).toBeTruthy();
    expect(screen.getByText('Old title')).toBeTruthy();
    expect(screen.getAllByText('Writer edited title').length).toBeGreaterThan(1);
    expect(screen.queryByText('Live, unchanged')).toBeNull();
    expect(screen.queryByText('No field values change.')).toBeNull();
    expect(screen.queryByText(/Rebase/)).toBeNull();
    expect(screen.queryByRole('button', { name: /Remove/ })).toBeNull();
  });

  it('says the diff was not recorded for a release shipped before change sets', async () => {
    renderInRouter(
      <ChangesTab review={reviewOf({ ...SHIPPED_SET, shippedSnapshot: null })} editable={false} />,
    );
    expect(
      await screen.findByText('This set shipped as a release, before change sets kept their diff.'),
    ).toBeTruthy();
    expect(screen.queryByRole('columnheader', { name: 'Before' })).toBeNull();
    expect(screen.queryByText('No field values change.')).toBeNull();
  });

  it('names the snapshot it shipped as and who shipped it', async () => {
    const flow = { stale: false, needsBreaking: false, needsDestructive: false, acknowledged: true };
    renderInRouter(
      <Banners set={SHIPPED_SET} flow={flow as ShipFlow} notices={[]} showAcknowledgementHint={false} />,
    );
    const banner = await screen.findByRole('status');
    expect(banner.textContent).toMatch(/^Shipped as v22 by Grace Shipper /);
    expect(screen.getByRole('link', { name: 'v22' }).getAttribute('href')).toBe('/snapshots/22');
  });
});
