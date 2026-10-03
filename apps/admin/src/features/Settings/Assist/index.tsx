import { useTranslation } from 'react-i18next';
import { useAssistStatus } from '@/api/assist';
import { Page } from '@/components/Page';
import { PageHeader } from '@/components/PageHeader';
import { Panel } from '@/components/Panel';
import { QueryView } from '@/components/QueryView';
import { StatusChip } from '@/components/StatusChip';
import { ASSIST_DOCS_URL } from '@/constants/assist';
import { ExternalLink } from '@/features/Publishing/ExternalLink';
import { TryIt } from './TryIt';
import { Usage } from './Usage';

/**
 * Settings → Assist: whether editor assists are on, with which provider and model, this month's usage
 * (for those who manage changes) and a place to try a rewrite. Configuration is environment-only (no key
 * entry here, by design), so the page links to the guide.
 */
export const Assist = () => {
  const { t } = useTranslation();
  const status = useAssistStatus();
  return (
    <Page width="narrow">
      <PageHeader title={t('settings.assist')} />
      <QueryView query={status} loadingRows={3}>
        {(data) => (
          <>
            <Panel
              title={t('assist.settings.status')}
              titleAs="h2"
              actions={
                <StatusChip
                  tone={data.enabled ? 'success' : 'muted'}
                  label={data.enabled ? t('assist.settings.on') : t('assist.settings.off')}
                />
              }
            >
              {data.enabled ? (
                <dl className="space-y-2 text-sm">
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">{t('assist.settings.provider')}</dt>
                    <dd className="font-mono">{data.provider}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">{t('assist.settings.model')}</dt>
                    <dd className="min-w-0 font-mono break-all">{data.model}</dd>
                  </div>
                </dl>
              ) : (
                <p className="text-sm">{t('assist.settings.offDescription')}</p>
              )}
              <p className="mt-4 text-meta">
                <ExternalLink href={ASSIST_DOCS_URL}>{t('assist.settings.guide')}</ExternalLink>
              </p>
            </Panel>
            {data.enabled && data.usage ? <Usage usage={data.usage} /> : null}
            {data.enabled ? <TryIt /> : null}
          </>
        )}
      </QueryView>
    </Page>
  );
};
