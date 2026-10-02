import { isModelDefinition, type ModelDefinition } from '@shapio/schema';
import { Workflow } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { graphqlPlaygroundUrl, useGraphqlPlaygroundAvailable } from '@/api/apiDocs';
import { useAllDefinitions } from '@/api/schema';
import { CodeBlock } from '@/components/CodeBlock';
import { EmptyState } from '@/components/EmptyState';
import { LoadingState } from '@/components/LoadingState';
import { Panel } from '@/components/Panel';
import { SubNav, SubNavGroup } from '@/components/SubNav';
import { SubNavLink } from '@/components/SubNavLink';
import { graphqlOperations } from '../helpers/graphqlQuery';

type GraphqlTabProps = { selected: string | undefined };

/**
 * GraphQL: the root query fields per place, with an example operation to copy, beside the vendored
 * GraphiQL (same origin, the admin session, introspection and docs included).
 */
export const GraphqlTab = ({ selected }: GraphqlTabProps) => {
  const { t } = useTranslation();
  const { definitions } = useAllDefinitions();
  const available = useGraphqlPlaygroundAvailable();
  const groups = useMemo(
    () =>
      (definitions ?? [])
        .map(({ definition }) => definition)
        .filter(isModelDefinition)
        .sort((a, b) => a.label.localeCompare(b.label))
        .map((model: ModelDefinition) => ({ model, operations: graphqlOperations(model) })),
    [definitions],
  );
  const operations = groups.flatMap((group) => group.operations);
  const operation = operations.find((candidate) => candidate.id === selected) ?? operations[0];
  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      {groups.length > 0 ? (
        <SubNav label={t('develop.api.graphql.operations')}>
          {groups.map(({ model, operations: modelOperations }) => (
            <SubNavGroup key={model.id} label={model.label}>
              {modelOperations.map((candidate) => (
                <SubNavLink
                  key={candidate.id}
                  to="/api-explorer"
                  search={{ tab: 'graphql', op: candidate.id }}
                  aria-current={candidate.id === operation?.id ? 'page' : undefined}
                >
                  <span className="min-w-0 truncate font-mono text-xs">{candidate.name}</span>
                </SubNavLink>
              ))}
            </SubNavGroup>
          ))}
        </SubNav>
      ) : null}
      <div className="min-w-0 flex-1 space-y-6">
        {operation ? (
          <Panel title={t('develop.api.graphql.example', { name: operation.name })}>
            <CodeBlock label={t('develop.api.graphql.query')} code={operation.query} />
          </Panel>
        ) : null}
        <Panel title={t('develop.api.graphql.playground')} flush>
          {available.isPending ? (
            <LoadingState rows={6} className="p-5" />
          ) : available.data ? (
            <iframe
              title={t('develop.api.graphql.playgroundFrame')}
              src={graphqlPlaygroundUrl()}
              className="block h-[40rem] w-full rounded-b-xl bg-card"
            />
          ) : (
            <EmptyState
              size="panel"
              icon={Workflow}
              title={t('develop.api.graphql.unavailable')}
              description={t('develop.api.graphql.unavailableDescription')}
            />
          )}
        </Panel>
      </div>
    </div>
  );
};
