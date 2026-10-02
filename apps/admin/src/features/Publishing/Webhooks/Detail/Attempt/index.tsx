import type { WebhookAttempt } from '@shapio/client';
import { useTranslation } from 'react-i18next';
import { formatDateTime } from '@/helpers/formatDate';
import { JsonBlock } from '../../../JsonBlock';
import { HeaderList } from '../HeaderList';
import { ResponseCode } from '../ResponseCode';

type AttemptProps = { attempt: WebhookAttempt };

/** One delivery attempt: the request sent and the response (or why none arrived). */
export const Attempt = ({ attempt }: AttemptProps) => {
  const { t } = useTranslation();
  const { request, response } = attempt;
  return (
    <li className="space-y-3 rounded-lg border bg-card p-4">
      <p className="text-sm font-medium">
        {t('publishing.webhooks.attemptHeading', {
          attempt: attempt.attempt,
          at: formatDateTime(attempt.at),
          duration: attempt.durationMs,
        })}
      </p>
      <div className="grid gap-3 lg:grid-cols-2">
        <section className="min-w-0 space-y-1">
          <h4 className="text-xs font-semibold text-muted-foreground">{t('publishing.webhooks.request')}</h4>
          <p className="font-mono text-xs break-all">{`${request.method} ${request.url}`}</p>
          <HeaderList headers={request.headers} label={t('publishing.webhooks.requestHeaders')} />
        </section>
        <section className="min-w-0 space-y-1">
          <h4 className="text-xs font-semibold text-muted-foreground">{t('publishing.webhooks.response')}</h4>
          {response ? (
            <>
              <ResponseCode
                status={response.status}
                label={t('publishing.webhooks.httpStatus', { status: response.status })}
              />
              <JsonBlock
                value={response.body}
                label={t('publishing.webhooks.responseBody')}
                className="max-h-40"
              />
              {response.truncated ? (
                <p className="text-xs text-muted-foreground">{t('publishing.webhooks.bodyTruncated')}</p>
              ) : null}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">{t('publishing.webhooks.noResponse')}</p>
          )}
          {attempt.error ? <p className="text-sm text-destructive">{attempt.error}</p> : null}
        </section>
      </div>
    </li>
  );
};
