import { isModelDefinition, type ModelDefinition } from '@shapio/schema';
import { Link } from '@tanstack/react-router';
import { Braces } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useAllDefinitions } from '@/api/schema';
import { CodeBlock } from '@/components/CodeBlock';
import { Panel } from '@/components/Panel';
import { SubNav, SubNavGroup } from '@/components/SubNav';
import { SubNavLink } from '@/components/SubNavLink';
import { Button } from '@/components/ui/button';
import { graphqlOperations, graphqlQuery, restOperationFor } from '../helpers/graphqlQuery';
import type { DeliveryOperation } from '../helpers/operations';
import type { RequestDraft } from '../helpers/request';

type GraphqlTabProps = {
  selected: string | undefined;
  /** The REST endpoints, to find the one each GraphQL operation mirrors. */
  restOperations: readonly DeliveryOperation[];
  /** The REST tab's request for an endpoint (empty when it was never edited). */
  draftOf: (operationId: string | undefined) => RequestDraft;
};

/**
 * GraphQL: the root query fields per place, and the selected one as a query that reads what the REST tab's
 * request for the same endpoint reads, to copy or open in the GraphQL page (the vendored GraphiQL).
 */
export const GraphqlTab = ({ selected, restOperations, draftOf }: GraphqlTabProps) => {
  const { t } = useTranslation();
  const { definitions } = useAllDefinitions();
  const groups = useMemo(
    () =>
      (definitions ?? [])
        .map(({ definition }) => definition)
        .filter(isModelDefinition)
        .sort((a, b) => a.label.localeCompare(b.label))
        .map((model: ModelDefinition) => ({ model, operations: graphqlOperations(model) })),
    [definitions],
  );
  const pairs = useMemo(
    () => groups.flatMap(({ model, operations }) => operations.map((operation) => ({ model, operation }))),
    [groups],
  );
  const current = pairs.find((pair) => pair.operation.id === selected) ?? pairs[0];
  const built = useMemo(() => {
    if (!current) {
      return undefined;
    }
    const rest = restOperationFor(current.model, current.operation, restOperations);
    return graphqlQuery(current.model, current.operation, draftOf(rest?.id));
  }, [current, restOperations, draftOf]);
  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      {groups.length > 0 ? (
        <SubNav label={t('develop.api.graphql.operations')}>
          {groups.map(({ model, operations }) => (
            <SubNavGroup key={model.id} label={model.label}>
              {operations.map((candidate) => (
                <SubNavLink
                  key={candidate.id}
                  to="/api-explorer"
                  search={{ tab: 'graphql', op: candidate.id }}
                  aria-current={candidate.id === current?.operation.id ? 'page' : undefined}
                >
                  <span className="min-w-0 truncate font-mono text-xs">{candidate.name}</span>
                </SubNavLink>
              ))}
            </SubNavGroup>
          ))}
        </SubNav>
      ) : null}
      <div className="min-w-0 flex-1">
        {current && built ? (
          <Panel
            title={t('develop.api.graphql.example', { name: current.operation.name })}
            description={
              built.skipped.length > 0
                ? t('develop.api.graphql.skipped', { params: built.skipped.join(', ') })
                : t('develop.api.graphql.fromRest')
            }
            actions={
              <Button asChild variant="outline" size="sm">
                <Link to="/develop/graphql" search={{ query: built.query }}>
                  <Braces aria-hidden="true" />
                  {t('develop.api.graphql.openInPlayground')}
                </Link>
              </Button>
            }
          >
            <CodeBlock label={t('develop.api.graphql.query')} code={built.query} />
          </Panel>
        ) : null}
      </div>
    </div>
  );
};
