import { CircleCheck } from 'lucide-react';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocales } from '@/api/locales';
import { EmptyState } from '@/components/EmptyState';
import { Panel } from '@/components/Panel';
import { QueryView } from '@/components/QueryView';
import { useContentSchema } from '@/features/Content/hooks/useContentSchema';
import type { AwaitingApprovalGroup } from '../hooks/useAwaitingApprovalGroup';
import type { useFindingGroups } from '../hooks/useFindingGroups';
import { ApprovalGroup } from './ApprovalGroup';
import { RuleGroup } from './RuleGroup';

type NeedsYouProps = ReturnType<typeof useFindingGroups> & {
  /** Change sets awaiting this admin's approval (plan approval), first. */
  approvals?: AwaitingApprovalGroup;
};

/**
 * Change sets awaiting the admin's approval, then content health findings the admin can act on, grouped by rule (listed from the per-rule summary; each group
 * pages through its own rule). Findings resolve by themselves when the content is fixed, so there is nothing
 * to dismiss.
 */
export const NeedsYou = ({ summary, groups, approvals }: NeedsYouProps) => {
  const { t } = useTranslation();
  const { schema } = useContentSchema();
  const locales = useLocales();
  const names = useMemo(
    () => new Map((locales.data ?? []).map((locale) => [locale.code, locale.label])),
    [locales.data],
  );
  const localeLabel = useCallback((code: string) => names.get(code) ?? code, [names]);
  const showLocale = names.size > 1;
  return (
    <Panel title={t('inbox.needsYou')} flush>
      <QueryView
        query={summary}
        loadingRows={4}
        isEmpty={() => groups.length === 0 && (approvals?.sets.length ?? 0) === 0}
        empty={
          <EmptyState
            compact
            icon={CircleCheck}
            title={t('inbox.allClear')}
            description={t('inbox.allClearDescription')}
          />
        }
      >
        {() => (
          <div className="divide-y">
            {approvals?.enabled ? <ApprovalGroup group={approvals} /> : null}
            {groups.map((group) => (
              <RuleGroup
                key={group.rule}
                group={group}
                models={schema?.models}
                localeLabel={localeLabel}
                showLocale={showLocale}
              />
            ))}
          </div>
        )}
      </QueryView>
    </Panel>
  );
};
