import type { ModelDefinition } from '@shapio/schema';
import { useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { lazy, Suspense } from 'react';
import { useEntryList } from '@/api/content';
import { ErrorState } from '@/components/ErrorState';
import { LoadingState } from '@/components/LoadingState';
import { Page } from '@/components/Page';
import { useContentLocales } from '../hooks/useContentLocales';
import type { ContentSchema } from '../hooks/useContentSchema';
import { useModelRoute } from '../hooks/useModelRoute';
import { ModelMissing } from '../ModelMissing';
import { Api } from './Api';
import type { PlaceTab } from './constants';
import { Entries } from './Entries';
import { Header } from './Header';
import { usePlaceCount } from './hooks/usePlaceCount';
import { usePlacePermissions } from './hooks/usePlacePermissions';
import { usePlaceSearch } from './hooks/usePlaceSearch';
import { Singleton } from './Singleton';
import { Tabs } from './Tabs';

// The builder (and @shapio/schema's validators) load only when the Structure tab opens.
const Structure = lazy(() => import('./Structure').then((module) => ({ default: module.Structure })));

type PlaceScreenProps = {
  schema: ContentSchema;
  model: ModelDefinition;
  locales: ReturnType<typeof useContentLocales>;
};

const PlaceScreen = ({ schema, model, locales }: PlaceScreenProps) => {
  const navigate = useNavigate({ from: '/content/$modelKey' });
  const permissions = usePlacePermissions(model);
  const placeSearch = usePlaceSearch(model, locales.current);
  const requested = placeSearch.search.tab ?? 'entries';
  const tab: PlaceTab = permissions.canManageSchema ? requested : 'entries';
  const collection = model.kind === 'collection';
  const list = useEntryList(model.apiKey, placeSearch.query, collection && tab === 'entries');
  const search = placeSearch.search;
  const unfiltered = !search.q && !search.status && !search.author && !(search.filters?.length ?? 0);
  const { count } = usePlaceCount(model, unfiltered ? list.data?.pagination.total : undefined);
  const onLocaleChange = (code: string) => placeSearch.setSearch({ locale: code });
  const content = () => {
    switch (tab) {
      case 'structure':
        return (
          <Suspense fallback={<LoadingState rows={6} />}>
            <Structure model={model} />
          </Suspense>
        );
      case 'api':
        return (
          <Page width="full">
            <Api schema={schema} model={model} />
          </Page>
        );
      case 'entries':
        return collection ? (
          <Page width="full">
            <Header
              model={model}
              count={count}
              locales={locales.locales}
              locale={locales.current}
              onLocaleChange={onLocaleChange}
              canCreate={permissions.canCreate}
            />
            <Entries
              schema={schema}
              model={model}
              locale={locales.current}
              localeLabelOf={locales.labelOf}
              placeSearch={placeSearch}
              list={list}
              permissions={permissions}
            />
          </Page>
        ) : (
          <Singleton
            schema={schema}
            model={model}
            locale={locales.current}
            onLocaleChange={(code) =>
              void navigate({ search: (previous) => ({ ...previous, locale: code }) })
            }
          />
        );
    }
  };
  return permissions.canManageSchema ? (
    <Tabs tab={tab} placeLabel={model.label} document={tab === 'entries' && !collection}>
      {content()}
    </Tabs>
  ) : (
    content()
  );
};

/**
 * `/content/$modelKey?tab=`: a place. A collection's entries (or a single type's document), and for admins
 * who manage its schema, its Structure (the builder) and API tabs. The model is resolved from the live
 * registry at render time (models are data), so a place created a moment ago opens at once.
 */
export const Place = () => {
  const { modelKey } = useParams({ from: '/app/content/$modelKey' });
  const search = useSearch({ from: '/app/content/$modelKey' });
  const { schema, model, error, pending } = useModelRoute(modelKey);
  const locales = useContentLocales(model, search.locale);
  if (error || locales.error) {
    return <ErrorState error={error ?? locales.error} />;
  }
  if (pending || !schema || locales.isPending) {
    return <LoadingState rows={6} />;
  }
  if (!model) {
    return (
      <Page>
        <ModelMissing modelKey={modelKey} />
      </Page>
    );
  }
  return <PlaceScreen key={model.id} schema={schema} model={model} locales={locales} />;
};
