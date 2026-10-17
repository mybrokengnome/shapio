import { CONTENT_OPS_RULES, type ContentOpsRule } from '@shapio/client';
import type { ModelDefinition } from '@shapio/schema';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { useAssistEnabled } from '@/api/assist';
import { ErrorState } from '@/components/ErrorState';
import { IconTile } from '@/components/IconTile';
import { LoadingState } from '@/components/LoadingState';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { RULE_ICONS, RULE_TITLE_KEYS } from '../../constants';
import type { FindingGroup } from '../../hooks/useFindingGroups';
import { useRuleGroupFindings } from '../../hooks/useRuleGroupFindings';
import { ProposeFixes } from '../../ProposeFixes';
import { Finding } from '../Finding';

type RuleGroupProps = {
  group: FindingGroup;
  models: ReadonlyMap<string, ModelDefinition> | undefined;
  localeLabel: (code: string) => string;
  showLocale: boolean;
};

const isContentOpsRule = (rule: string): rule is ContentOpsRule =>
  (CONTENT_OPS_RULES as readonly string[]).includes(rule);

/**
 * One rule's findings: a heading with the rule's count, the first few rows, then "Show all" in place, which
 * pages through that rule's findings with "Load more" inside the group.
 */
export const RuleGroup = ({ group, models, localeLabel, showLocale }: RuleGroupProps) => {
  const { t } = useTranslation();
  const headingId = useId();
  const assistEnabled = useAssistEnabled();
  const { query, findings, canShowAll, showAll, hasMore, loadMore, loadingMore } = useRuleGroupFindings(
    group.rule,
  );
  // The summary can count findings this admin's row filter hides on every page: nothing to show then.
  if (query.isSuccess && findings.length === 0 && !query.hasNextPage) {
    return null;
  }
  return (
    <section aria-labelledby={headingId} className="py-1">
      <div className="flex items-center gap-3 px-5 pt-3 pb-1">
        <IconTile icon={RULE_ICONS[group.rule]} size="sm" tone="warning" />
        <h3 id={headingId} className="min-w-0 flex-1 truncate text-sm font-semibold">
          {t(RULE_TITLE_KEYS[group.rule])}
        </h3>
        <Badge variant="secondary" className="tabular-nums">
          {group.count.toLocaleString()}
        </Badge>
      </div>
      {assistEnabled && isContentOpsRule(group.rule) ? <ProposeFixes rule={group.rule} /> : null}
      {query.isPending ? (
        <LoadingState rows={2} className="px-5 py-2" />
      ) : query.isError ? (
        <ErrorState size="panel" error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <ul className="divide-y">
          {findings.map((finding) => (
            <Finding
              key={finding.id}
              finding={finding}
              model={models?.get(finding.modelId)}
              localeLabel={localeLabel}
              showLocale={showLocale}
            />
          ))}
        </ul>
      )}
      {canShowAll || hasMore ? (
        <div className="px-5 pb-2">
          <Button
            variant="ghost"
            size="sm"
            aria-describedby={headingId}
            disabled={loadingMore}
            onClick={canShowAll ? showAll : loadMore}
          >
            {loadingMore
              ? t('common.loading')
              : canShowAll
                ? t('inbox.showAll', { count: group.count })
                : t('inbox.loadMore')}
          </Button>
        </div>
      ) : null}
    </section>
  );
};
