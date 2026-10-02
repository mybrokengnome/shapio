import { routeKeyOf, type ModelDefinition, type SchemaDefinition } from '@shapio/schema';
import { Link } from '@tanstack/react-router';
import { ArrowUpRight } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { CopyButton } from '@/components/CopyButton';
import { PageHeader } from '@/components/PageHeader';
import { Panel } from '@/components/Panel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { graphqlSdl, restEndpoints, type RestEndpoint } from '@/features/Develop/Schema/helpers/shapes';
import type { ContentSchema } from '../../hooks/useContentSchema';

type ApiProps = { schema: ContentSchema; model: ModelDefinition };

type EndpointListProps = { title: string; endpoints: readonly RestEndpoint[] };

const EndpointList = ({ title, endpoints }: EndpointListProps) => (
  <Panel title={title} flush>
    <ul className="divide-y">
      {endpoints.map((endpoint) => (
        <li key={`${endpoint.method} ${endpoint.path}`} className="flex items-center gap-3 px-5 py-2.5">
          <Badge variant="outline" className="w-16 justify-center font-mono">
            {endpoint.method}
          </Badge>
          <code className="min-w-0 flex-1 truncate font-mono text-sm">{endpoint.path}</code>
          <CopyButton value={endpoint.path} />
        </li>
      ))}
    </ul>
  </Panel>
);

/** What the place looks like to code: its REST endpoints and GraphQL type, from the live registry. */
export const Api = ({ schema, model }: ApiProps) => {
  const { t } = useTranslation();
  const lookup = useMemo(
    () => new Map<string, SchemaDefinition>([...schema.models, ...schema.components]),
    [schema],
  );
  const endpoints = restEndpoints(model);
  return (
    <>
      <PageHeader
        title={model.label}
        meta={t('place.api.meta', { apiKey: model.apiKey, routeKey: routeKeyOf(model) })}
        actions={
          <Button asChild variant="outline">
            <Link to="/api-explorer">
              {t('place.api.explorer')}
              <ArrowUpRight aria-hidden="true" />
            </Link>
          </Button>
        }
      />
      <div className="grid min-w-0 gap-6 xl:grid-cols-2 xl:items-start">
        <div className="min-w-0 space-y-6">
          <EndpointList
            title={t('place.api.delivery')}
            endpoints={endpoints.filter((endpoint) => endpoint.scope === 'delivery')}
          />
          <EndpointList
            title={t('place.api.admin')}
            endpoints={endpoints.filter((endpoint) => endpoint.scope === 'admin')}
          />
        </div>
        <Panel title={t('place.api.graphql')} actions={<CopyButton value={graphqlSdl(model, lookup)} />}>
          <pre
            // Wide SDL scrolls sideways: the block is a Tab stop so the keyboard can scroll it too.
            tabIndex={0}
            aria-label={t('place.api.graphqlSchema', { place: model.label })}
            className="overflow-x-auto rounded-lg bg-muted p-4 font-mono text-xs leading-relaxed outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            {graphqlSdl(model, lookup)}
          </pre>
        </Panel>
      </div>
    </>
  );
};
