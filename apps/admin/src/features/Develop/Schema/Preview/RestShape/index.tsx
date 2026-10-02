import { isModelDefinition, type SchemaDefinition } from '@shapio/schema';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { CodeBlock } from '@/components/CodeBlock';
import { Badge } from '@/components/ui/badge';
import { restEndpoints, restResponseSample, type DefinitionLookup } from '../../helpers/shapes';

type RestShapeProps = { definition: SchemaDefinition; lookup: DefinitionLookup };

/** The REST endpoints the definition gets and an example delivery response. */
export const RestShape = ({ definition, lookup }: RestShapeProps) => {
  const { t } = useTranslation();
  const endpoints = restEndpoints(definition);
  const sample = useMemo(() => restResponseSample(definition, lookup), [definition, lookup]);
  return (
    <div className="space-y-5">
      {isModelDefinition(definition) ? (
        <ul aria-label={t('develop.schema.preview.endpoints')} className="space-y-1.5">
          {endpoints.map((endpoint) => (
            <li key={`${endpoint.method} ${endpoint.path}`} className="flex min-w-0 items-center gap-2">
              <Badge variant="outline" className="w-16 justify-center font-mono">
                {endpoint.method}
              </Badge>
              <code className="min-w-0 truncate font-mono text-xs">{endpoint.path}</code>
              {endpoint.scope === 'admin' ? (
                <Badge variant="secondary" className="ml-auto shrink-0">
                  {t('develop.schema.preview.admin')}
                </Badge>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">{t('develop.schema.preview.componentEndpoints')}</p>
      )}
      <CodeBlock
        label={
          isModelDefinition(definition)
            ? t('develop.schema.preview.responseSample')
            : t('develop.schema.preview.componentSample')
        }
        code={sample}
      />
    </div>
  );
};
