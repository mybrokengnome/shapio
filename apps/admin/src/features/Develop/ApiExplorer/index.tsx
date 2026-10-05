import { getRouteApi } from '@tanstack/react-router';
import { Braces } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useOpenApiDocument, type OpenApiDocument } from '@/api/apiDocs';
import { EmptyState } from '@/components/EmptyState';
import { Page } from '@/components/Page';
import { PageHeader } from '@/components/PageHeader';
import { QueryView } from '@/components/QueryView';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { GraphqlTab } from './GraphqlTab';
import { deliveryOperations, groupOperations } from './helpers/operations';
import { useRequestDrafts } from './hooks/useRequestDrafts';
import { useSwitchTab } from './hooks/useSwitchTab';
import { RestTab } from './RestTab';
import { EXPLORER_TABS, type ExplorerTab } from './searchSchema';

const route = getRouteApi('/app/api-explorer');

const TAB_LABEL_KEYS = {
  rest: 'develop.api.tabs.rest',
  graphql: 'develop.graphql.title',
} as const satisfies Record<ExplorerTab, string>;

type ExplorerProps = { document: OpenApiDocument };

const Explorer = ({ document }: ExplorerProps) => {
  const { t } = useTranslation();
  const { tab = 'rest', op } = route.useSearch();
  const operations = useMemo(() => deliveryOperations(document), [document]);
  const groups = useMemo(() => groupOperations(document, operations), [document, operations]);
  const operation = operations.find((candidate) => candidate.id === op) ?? groups[0]?.operations[0];
  const { draftOf, setDraft } = useRequestDrafts();
  const switchTab = useSwitchTab(operations, tab === 'rest' ? operation?.id : op);
  return (
    <Tabs value={tab} onValueChange={(value) => switchTab(value as ExplorerTab)}>
      <PageHeader
        title={t('develop.apiExplorerTitle')}
        meta={t('develop.api.meta', { version: document.info.version, count: operations.length })}
        tabs={
          <TabsList variant="underline" aria-label={t('develop.api.tabs.label')}>
            {EXPLORER_TABS.map((value) => (
              <TabsTrigger key={value} value={value}>
                {t(TAB_LABEL_KEYS[value])}
              </TabsTrigger>
            ))}
          </TabsList>
        }
      />
      <TabsContent value="rest" className="pt-4">
        {operation ? (
          <RestTab
            groups={groups}
            operation={operation}
            draft={draftOf(operation.id)}
            onDraftChange={(next) => setDraft(operation.id, next)}
          />
        ) : (
          <EmptyState
            icon={Braces}
            title={t('develop.api.empty')}
            description={t('develop.api.emptyDescription')}
          />
        )}
      </TabsContent>
      <TabsContent value="graphql" className="pt-4">
        <GraphqlTab selected={op} restOperations={operations} draftOf={draftOf} />
      </TabsContent>
    </Tabs>
  );
};

/**
 * The API explorer (plan developer-face §2): delivery endpoints from the live OpenAPI document, a request
 * builder that calls the API as a site would (anonymous or with a pasted token), the live response and the
 * shape; GraphQL as the same request in a query, opened in the GraphQL page's vendored GraphiQL.
 */
export const ApiExplorer = () => {
  const query = useOpenApiDocument();
  return (
    <Page width="full">
      <QueryView query={query}>{(document) => <Explorer document={document} />}</QueryView>
    </Page>
  );
};
