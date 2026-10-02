import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useContentHealthSummary } from '@/api/contentHealth';
import { Panel } from '@/components/Panel';
import { QueryView } from '@/components/QueryView';
import { StatusChip } from '@/components/StatusChip';
import { RULE_ORDER, RULE_TITLE_KEYS } from '@/features/Inbox/constants';

/** Open content-health findings per rule, linking to the Inbox where they are fixed. */
export const HealthCard = () => {
  const { t } = useTranslation();
  const health = useContentHealthSummary();
  return (
    <Panel title={t('develop.live.healthTitle')}>
      <QueryView query={health} loadingRows={2}>
        {(data) => {
          const counts = new Map(data.rules.map(({ rule, count }) => [rule, count]));
          const open = RULE_ORDER.filter((rule) => (counts.get(rule) ?? 0) > 0);
          const total = open.reduce((sum, rule) => sum + (counts.get(rule) ?? 0), 0);
          return (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <StatusChip
                  tone={total > 0 ? 'warning' : 'success'}
                  label={t('develop.live.healthOpen', { count: total })}
                />
                <Link to="/" className="text-sm text-link underline-offset-4 hover:underline">
                  {t('develop.live.openInbox')}
                </Link>
              </div>
              {open.length > 0 ? (
                <ul className="space-y-1 text-sm">
                  {open.map((rule) => (
                    <li key={rule} className="flex justify-between gap-3">
                      <span>{t(RULE_TITLE_KEYS[rule])}</span>
                      <span className="tabular-nums">{counts.get(rule)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-meta text-muted-foreground">{t('develop.live.healthClean')}</p>
              )}
            </div>
          );
        }}
      </QueryView>
    </Panel>
  );
};
