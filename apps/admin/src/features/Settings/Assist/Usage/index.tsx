import type { AssistUsage } from '@shapio/client';
import { useTranslation } from 'react-i18next';
import { Panel } from '@/components/Panel';
import { formatMonth } from '@/helpers/formatDate';

type UsageProps = { usage: AssistUsage };

/** This month's assist runs and tokens on this site (only for those who manage changes). */
export const Usage = ({ usage }: UsageProps) => {
  const { t } = useTranslation();
  const rows = [
    { key: 'runs', label: t('assist.settings.runs'), value: usage.runs },
    { key: 'input', label: t('assist.settings.inputTokens'), value: usage.inputTokens },
    { key: 'output', label: t('assist.settings.outputTokens'), value: usage.outputTokens },
  ];
  return (
    <Panel title={t('assist.settings.usage', { month: formatMonth(usage.month) })} titleAs="h2">
      <dl className="grid gap-4 sm:grid-cols-3">
        {rows.map((row) => (
          <div key={row.key} className="space-y-1">
            <dt className="text-meta text-muted-foreground">{row.label}</dt>
            <dd className="text-2xl font-semibold tabular-nums">{row.value.toLocaleString()}</dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
};
