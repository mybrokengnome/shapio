import type { ContentHealthFinding, HealthRule } from '@shapio/client';
import { useMemo } from 'react';
import { useContentHealthFindings, useContentHealthSummary } from '@/api/contentHealth';
import { FINDINGS_PAGE_SIZE, RULE_ORDER } from '../constants';

export type FindingGroup = {
  rule: HealthRule;
  /** Open findings of the rule (from the summary; at least the loaded ones). */
  count: number;
  findings: ContentHealthFinding[];
};

/** Open findings grouped by rule, in RULE_ORDER, with the query state the Inbox needs. */
export const useFindingGroups = () => {
  const findings = useContentHealthFindings({ limit: FINDINGS_PAGE_SIZE });
  const summary = useContentHealthSummary();
  const groups = useMemo((): FindingGroup[] => {
    const byRule = new Map<HealthRule, ContentHealthFinding[]>();
    for (const finding of findings.data?.pages.flatMap((page) => page.items) ?? []) {
      byRule.set(finding.rule, [...(byRule.get(finding.rule) ?? []), finding]);
    }
    const counts = new Map(summary.data?.rules.map(({ rule, count }) => [rule, count]));
    return RULE_ORDER.flatMap((rule) => {
      const items = byRule.get(rule) ?? [];
      const count = Math.max(counts.get(rule) ?? 0, items.length);
      return items.length > 0 ? [{ rule, count, findings: items }] : [];
    });
  }, [findings.data, summary.data]);
  const total = summary.data?.rules.reduce((sum, { count }) => sum + count, 0);
  return { findings, groups, total };
};
