import type { ContentHealthSummary, HealthRule } from '@shapio/client';
import { useMemo } from 'react';
import { useContentHealthSummary } from '@/api/contentHealth';
import { RULE_ORDER } from '../constants';

export type FindingGroup = {
  rule: HealthRule;
  /** Open findings of the rule the admin may see (from the summary). */
  count: number;
};

/** The groups to show, in RULE_ORDER: every rule the summary counts findings for. */
export const groupsOf = (summary: ContentHealthSummary | undefined): FindingGroup[] => {
  const counts = new Map(summary?.rules.map(({ rule, count }) => [rule, count]));
  return RULE_ORDER.flatMap((rule) => {
    const count = counts.get(rule) ?? 0;
    return count > 0 ? [{ rule, count }] : [];
  });
};

/**
 * The Inbox's "Needs you" groups, listed from the per-rule summary (one request), so a rule shows even when
 * none of its findings are among the newest. Each group then reads its own findings (`useRuleFindings`).
 */
export const useFindingGroups = () => {
  const summary = useContentHealthSummary();
  const groups = useMemo(() => groupsOf(summary.data), [summary.data]);
  const total = summary.data?.rules.reduce((sum, { count }) => sum + count, 0);
  return { summary, groups, total };
};
