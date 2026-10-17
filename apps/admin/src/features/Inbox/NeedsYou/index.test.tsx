// @vitest-environment jsdom
import '@/test/dom';
import type { ContentHealthFinding, ContentHealthQuery } from '@shapio/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { groupsOf, useFindingGroups } from '../hooks/useFindingGroups';
import { NeedsYou } from '.';

const mocks = vi.hoisted(() => ({ list: vi.fn(), summary: vi.fn() }));

vi.mock('@/api/client', () => ({
  adminApi: { contentHealth: { list: mocks.list, summary: mocks.summary } },
}));
vi.mock('@/api/assist', () => ({ useAssistEnabled: () => false }));
vi.mock('@/api/locales', () => ({ useLocales: () => ({ data: [{ code: 'en', label: 'English' }] }) }));
vi.mock('@/features/Content/hooks/useContentSchema', () => ({
  useContentSchema: () => ({
    schema: {
      models: new Map([
        [
          'article-id',
          {
            id: 'article-id',
            kind: 'collection',
            apiKey: 'article',
            label: 'Article',
            fields: [
              { apiKey: 'related', label: 'Related guides' },
              { apiKey: 'cover', label: 'Cover' },
            ],
          },
        ],
      ]),
    },
  }),
}));

const finding = (
  id: string,
  rule: ContentHealthFinding['rule'],
  extra: Partial<ContentHealthFinding> = {},
) => ({
  id,
  entryId: 'entry-1',
  modelId: 'article-id',
  modelKey: 'article',
  entryTitle: 'How to Download',
  locale: 'en',
  rule,
  subject: id,
  severity: 'warning',
  params: {},
  firstSeenAt: '2026-10-01T00:00:00.000Z',
  lastSeenAt: '2026-10-01T00:00:00.000Z',
  ...extra,
});

const altFindings = Array.from({ length: 112 }, (_, index) =>
  finding(`alt-${index}`, 'altMissing', { entryTitle: `Gallery ${index}`, path: '/cover' }),
);
const linkFindings = [
  finding('link-1', 'relationUnpublished', {
    path: '/related',
    params: { targetEntryId: '11111111-1111-4111-8111-111111111111' },
    targetTitle: 'Trading with the Mobile App',
  }),
  finding('link-2', 'relationUnpublished', {
    path: '/related',
    params: { targetEntryId: '22222222-2222-4222-8222-222222222222' },
    targetTitle: 'Charting Basics',
  }),
];

/** The API: newest first per rule, paged by an index cursor. */
const listFindings = ({ rule, limit = 50, cursor }: ContentHealthQuery) => {
  const all = rule === 'altMissing' ? altFindings : rule === 'relationUnpublished' ? linkFindings : [];
  const start = cursor ? Number(cursor) : 0;
  const end = start + limit;
  return Promise.resolve({ items: all.slice(start, end), nextCursor: end < all.length ? String(end) : null });
};

const Panel = () => <NeedsYou {...useFindingGroups()} />;

const renderPanel = () => {
  mocks.list.mockReset().mockImplementation(listFindings);
  mocks.summary.mockReset().mockResolvedValue({
    rules: [
      { rule: 'altMissing', count: altFindings.length },
      { rule: 'relationUnpublished', count: linkFindings.length },
    ],
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const node: ReactNode = <Panel />;
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

const groupNamed = async (name: string) =>
  (await screen.findByRole('heading', { level: 3, name })).closest('section') as HTMLElement;

describe('groupsOf', () => {
  it('lists every rule the summary counts, in rule order, and none without findings', () => {
    expect(
      groupsOf({
        rules: [
          { rule: 'relationUnpublished', count: 5 },
          { rule: 'staleDraft', count: 0 },
          { rule: 'altMissing', count: 548 },
        ],
      }),
    ).toEqual([
      { rule: 'altMissing', count: 548 },
      { rule: 'relationUnpublished', count: 5 },
    ]);
  });
});

describe('Needs you', () => {
  it('shows a rule whose findings are all past the newest page, from its own request', async () => {
    renderPanel();
    const links = await groupNamed('Links to unpublished entries');
    expect(await within(links).findAllByRole('listitem')).toHaveLength(2);
    expect(mocks.list).toHaveBeenCalledWith({ rule: 'relationUnpublished', limit: 5 });
    expect(mocks.list).toHaveBeenCalledWith({ rule: 'altMissing', limit: 5 });
  });

  it('names each linked entry, and gives each row its own link to that entry in the field', async () => {
    renderPanel();
    const links = await groupNamed('Links to unpublished entries');
    const rows = await within(links).findAllByRole('listitem');
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('Related guides links to “Trading with the Mobile App”, which isn’t live'),
      expect.stringContaining('Related guides links to “Charting Basics”, which isn’t live'),
    ]);
    const hrefs = rows.map((row) => within(row).getByRole('link').getAttribute('href'));
    expect(hrefs).toEqual([
      '/content/article/entry-1?locale=en&target=11111111-1111-4111-8111-111111111111#related',
      '/content/article/entry-1?locale=en&target=22222222-2222-4222-8222-222222222222#related',
    ]);
  });

  it('pages one group by its own count: preview, Show all, then Load more inside the group', async () => {
    renderPanel();
    const images = await groupNamed('Images without alt text');
    expect(await within(images).findAllByRole('listitem')).toHaveLength(5);
    fireEvent.click(within(images).getByRole('button', { name: 'Show all 112' }));
    await within(images).findByText('Gallery 104');
    expect(within(images).getAllByRole('listitem')).toHaveLength(105);
    expect(mocks.list).toHaveBeenCalledWith({ rule: 'altMissing', limit: 100, cursor: '5' });
    fireEvent.click(within(images).getByRole('button', { name: 'Load more' }));
    await within(images).findByText('Gallery 111');
    expect(within(images).getAllByRole('listitem')).toHaveLength(112);
    expect(within(images).queryByRole('button', { name: 'Load more' })).toBeNull();
    // The other group is untouched, and there is no panel-wide Load more.
    expect(within(await groupNamed('Links to unpublished entries')).queryByRole('button')).toBeNull();
  });
});
