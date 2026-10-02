import { CircleCheck } from 'lucide-react';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocales } from '@/api/locales';
import { EmptyState } from '@/components/EmptyState';
import { Panel } from '@/components/Panel';
import { QueryView } from '@/components/QueryView';
import { Button } from '@/components/ui/button';
import { useContentSchema } from '@/features/Content/hooks/useContentSchema';
import type { useFindingGroups } from '../hooks/useFindingGroups';
import { RuleGroup } from './RuleGroup';

type NeedsYouProps = ReturnType<typeof useFindingGroups>;

/**
 * Content health findings the admin can act on, grouped by rule. Findings resolve by themselves when the
 * content is fixed, so there is nothing to dismiss.
 */
export const NeedsYou = ({ findings, groups }: NeedsYouProps) => {
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
        query={findings}
        loadingRows={4}
        isEmpty={() => groups.length === 0}
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
            {groups.map((group) => (
              <RuleGroup
                key={group.rule}
                group={group}
                models={schema?.models}
                localeLabel={localeLabel}
                showLocale={showLocale}
              />
            ))}
            {findings.hasNextPage ? (
              <div className="px-5 py-3">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={findings.isFetchingNextPage}
                  onClick={() => void findings.fetchNextPage()}
                >
                  {findings.isFetchingNextPage ? t('common.loading') : t('inbox.loadMore')}
                </Button>
              </div>
            ) : null}
          </div>
        )}
      </QueryView>
    </Panel>
  );
};
