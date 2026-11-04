// @vitest-environment jsdom
import '@/test/dom';
import type { HealthRule } from '@shapio/client';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RuleGroup } from '.';

const mocks = vi.hoisted(() => ({ canManageChanges: false }));

vi.mock('@/api/assist', () => ({ useAssistEnabled: () => true }));
vi.mock('@/api/auth', () => ({ useHasGlobalPermission: () => mocks.canManageChanges }));
vi.mock('../../hooks/useRuleGroupFindings', () => ({
  useRuleGroupFindings: () => ({
    query: { isSuccess: true, isPending: false, isError: false, hasNextPage: false },
    findings: [{ id: 'finding-1' }],
    canShowAll: false,
    showAll: () => undefined,
    hasMore: false,
    loadMore: () => undefined,
    loadingMore: false,
  }),
}));
vi.mock('../Finding', () => ({ Finding: () => <li>finding</li> }));
vi.mock('../../ProposeFixes', () => ({
  ProposeFixes: ({ rule }: { rule: string }) => <p>Propose fixes for {rule}</p>,
}));

const renderGroup = (rule: HealthRule) =>
  render(
    <RuleGroup
      group={{ rule, count: 1 }}
      models={new Map()}
      localeLabel={(code) => code}
      showLocale={false}
    />,
  );

describe('RuleGroup: Propose fixes', () => {
  beforeEach(() => {
    mocks.canManageChanges = false;
  });

  it('offers runs whose fixes land in a change set only with changes.manage', () => {
    renderGroup('requiredEmpty');
    expect(screen.queryByText(/Propose fixes for/)).toBeNull();
    renderGroup('localeMissing');
    expect(screen.queryByText(/Propose fixes for/)).toBeNull();
  });

  it('offers them with changes.manage', () => {
    mocks.canManageChanges = true;
    renderGroup('requiredEmpty');
    expect(screen.getByText('Propose fixes for requiredEmpty')).toBeTruthy();
  });

  it('offers alt text fixes either way (they are saved to the library, not a change set)', () => {
    renderGroup('altMissing');
    expect(screen.getByText('Propose fixes for altMissing')).toBeTruthy();
  });
});
