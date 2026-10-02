import { Radio } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { CodeBlock } from '@/components/CodeBlock';
import { EmptyState } from '@/components/EmptyState';
import { Panel } from '@/components/Panel';
import { StatusChip } from '@/components/StatusChip';
import { responseEntries } from '../helpers/entries';
import type { ExplorerResponse } from '../hooks/useSendRequest';
import { EntryLinks } from './EntryLinks';

type ResponseViewProps = { response: ExplorerResponse | undefined; modelKey: string | undefined };

/** The live response: status and timing, the returned entries (with "Edit entry"), and the JSON. */
export const ResponseView = ({ response, modelKey }: ResponseViewProps) => {
  const { t } = useTranslation();
  const entries = useMemo(() => (response?.ok ? responseEntries(response.body) : []), [response]);
  const pretty = useMemo(
    () =>
      response && typeof response.body !== 'string' ? JSON.stringify(response.body, null, 2) : response?.text,
    [response],
  );
  return (
    <Panel
      title={t('develop.api.response.title')}
      actions={
        response ? (
          <>
            <StatusChip
              tone={response.ok ? 'success' : 'danger'}
              label={`${response.status} ${response.statusText}`.trim()}
              size="sm"
            />
            <span className="text-meta text-muted-foreground tabular-nums">
              {t('develop.api.response.duration', { ms: response.durationMs })}
            </span>
          </>
        ) : null
      }
    >
      {response ? (
        <div className="space-y-4">
          <p role="status" className="sr-only">
            {t('develop.api.response.announce', { status: response.status, ms: response.durationMs })}
          </p>
          {entries.length > 0 && modelKey ? <EntryLinks entries={entries} modelKey={modelKey} /> : null}
          <CodeBlock label={t('develop.api.response.body')} code={pretty ?? ''} />
        </div>
      ) : (
        <EmptyState size="panel" icon={Radio} title={t('develop.api.response.empty')} />
      )}
    </Panel>
  );
};
