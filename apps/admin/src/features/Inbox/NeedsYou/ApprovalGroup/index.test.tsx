// @vitest-environment jsdom
import '@/test/dom';
import type { ChangeSetSummary } from '@shapio/client';
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { AwaitingApprovalGroup } from '../../hooks/useAwaitingApprovalGroup';
import { ApprovalGroup } from '.';

const summary = (id: string, title: string, note: string): ChangeSetSummary =>
  ({
    id,
    title,
    updatedAt: '2026-10-01T00:00:00.000Z',
    approval: {
      status: 'requested',
      note,
      round: 1,
      requestedBy: { type: 'admin', id: 'a1', name: 'Ada Writer' },
      requestedAt: '2026-10-01T00:00:00.000Z',
      outdated: false,
      approvedAtShip: null,
      eligible: true,
      eligibleReason: null,
      stage: { index: 1, id: 'legal', name: 'Legal', required: 2, signed: 1 },
    },
  }) as unknown as ChangeSetSummary;

const groupOf = (sets: ChangeSetSummary[], extra: Partial<AwaitingApprovalGroup> = {}) =>
  ({
    enabled: true,
    query: { isError: false },
    sets,
    count: sets.length,
    hasMorePages: false,
    canShowAll: false,
    showAll: vi.fn(),
    hasMore: false,
    loadMore: vi.fn(),
    loadingMore: false,
    ...extra,
  }) as unknown as AwaitingApprovalGroup;

const renderGroup = (group: AwaitingApprovalGroup) => {
  const node: ReactNode = <ApprovalGroup group={group} />;
  const router = createRouter({
    routeTree: createRootRoute({ component: () => node }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  render(<RouterProvider router={router} />);
};

describe('Awaiting your approval (plan approval-workflows)', () => {
  it('lists each set with who asked, the stage it is at, the note, and a link to review it', async () => {
    renderGroup(groupOf([summary('set-1', 'Spring launch', 'Check the hero copy')]));
    const section = (
      await screen.findByRole('heading', { level: 3, name: 'Awaiting your approval' })
    ).closest('section') as HTMLElement;
    const row = within(section).getByRole('listitem');
    expect(row.textContent).toContain('Spring launch');
    expect(row.textContent).toContain('Requested by Ada Writer');
    expect(row.textContent).toContain('Legal 1/2');
    expect(row.textContent).toContain('Check the hero copy');
    expect(within(row).getByRole('link', { name: 'Review' }).getAttribute('href')).toBe('/changes/set-1');
  });
});
