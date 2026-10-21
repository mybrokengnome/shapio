import type { DefinitionListItem } from '@shapio/client';
import type { QueryClient } from '@tanstack/react-query';
import { redirect } from '@tanstack/react-router';
import { definitionsQueryOptions } from '@/api/schema';
import type { ModelTab } from '@/features/Models/constants';

/**
 * The old `/models/*` URLs (bookmarks, links in older builds) after "Models" left the navigation (plan
 * editor-experience §6, §9): a model's builder is the Structure tab of its place, components live under
 * Develop, and new types are created at `/content/new`.
 */

/** Develop pages for the definition categories that are not content types. */
const CATEGORY_LISTS = {
  components: '/develop/components',
  interfaces: '/develop/interfaces',
} as const;

/** `/models?tab=` → the places (or Develop → Components for the components tab). */
export const redirectModelsIndex = (tab: ModelTab | undefined): never => {
  throw tab === 'components'
    ? redirect({ to: '/develop/components', replace: true })
    : redirect({ to: '/content', replace: true });
};

/** `/models/new?kind=` → `/content/new`, or the new-component or new-interface page. */
export const redirectNewModel = (kind: string | undefined): never => {
  if (kind === 'component') {
    throw redirect({ to: '/develop/components/new', replace: true });
  }
  if (kind === 'interface') {
    throw redirect({ to: '/develop/interfaces/new', replace: true });
  }
  throw redirect({ to: '/content/new', replace: true });
};

/** `/models/components/:id` → `/develop/components/:id` (component IDs are unchanged). */
export const redirectComponentBuilder = (componentId: string): never => {
  throw redirect({ to: '/develop/components/$componentId', params: { componentId }, replace: true });
};

/** `/models/interfaces/:id` → `/develop/interfaces/:id`. */
export const redirectInterfaceBuilder = (interfaceId: string): never => {
  throw redirect({ to: '/develop/interfaces/$interfaceId', params: { interfaceId }, replace: true });
};

/**
 * `/models/:modelId` → `/content/:apiKey?tab=structure`. The ID is resolved through the cached registry; a
 * model created a moment ago may not be cached yet, so a miss reads the registry once more.
 */
export const redirectModelBuilder = async (queryClient: QueryClient, modelId: string): Promise<never> => {
  if (modelId === 'components' || modelId === 'interfaces') {
    throw redirect({ to: CATEGORY_LISTS[modelId], replace: true });
  }
  const options = definitionsQueryOptions('model');
  const find = (items: readonly DefinitionListItem[]) =>
    items.find(({ definition }) => definition.id === modelId)?.definition;
  const model =
    find(await queryClient.ensureQueryData(options)) ??
    find(await queryClient.fetchQuery({ ...options, staleTime: 0 }));
  if (!model) {
    // Deleted since the link was made: the places are the closest thing left.
    throw redirect({ to: '/content', replace: true });
  }
  throw redirect({
    to: '/content/$modelKey',
    params: { modelKey: model.apiKey },
    search: { tab: 'structure' },
    replace: true,
  });
};
