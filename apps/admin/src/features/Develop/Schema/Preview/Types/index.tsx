import { FileType } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useTypeScriptDeclarations } from '@/api/apiDocs';
import { CodeBlock } from '@/components/CodeBlock';
import { EmptyState } from '@/components/EmptyState';
import { QueryView } from '@/components/QueryView';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { declarationsOf } from '../../helpers/declarations';

type TypesProps = { apiKey: string; edited: boolean };

/**
 * The definition's declarations from `shapio types generate` (`GET /api/docs/typescript`), i.e. of the
 * active version; edits show here once their change set ships.
 */
export const Types = ({ apiKey, edited }: TypesProps) => {
  const { t } = useTranslation();
  const query = useTypeScriptDeclarations();
  return (
    <QueryView query={query}>
      {({ source, schemaVersion }) => {
        const code = declarationsOf(source, apiKey);
        return (
          <div className="space-y-4">
            {edited ? (
              <Alert variant="info">
                <AlertDescription>
                  {t('develop.schema.preview.typesActive', { version: schemaVersion })}
                </AlertDescription>
              </Alert>
            ) : null}
            {code ? (
              <CodeBlock label={t('develop.schema.preview.typescript')} code={code} />
            ) : (
              <EmptyState size="panel" icon={FileType} title={t('develop.schema.preview.noTypes')} />
            )}
          </div>
        );
      }}
    </QueryView>
  );
};
