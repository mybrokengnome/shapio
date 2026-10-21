import { isModelDefinition } from '@shapio/schema';
import { useMemo } from 'react';
import { useMe } from '@/api/auth';
import { useContentCounts } from '@/api/contentCounts';
import { canOnModel } from '@/helpers/modelPermissions';
import { useResolvedDefinitions } from '@/hooks/useResolvedDefinitions';
import { buildPlaceTree, type PlaceSource } from '../helpers/placeTree';
import { useModelPermissionsRefresh } from './useModelPermissionsRefresh';

/** A content type as editors see it: a place in the sidebar. */
export type Place = {
  id: string;
  apiKey: string;
  label: string;
  kind: 'collection' | 'singleton';
  /**
   * Entries the admin can read, a type's including its kinds' (its list shows them all; the server counts
   * them so); undefined until counts load (or for single types, which need none).
   */
  count: number | undefined;
  canCreate: boolean;
  /** Shared with all sites (rather than this site's own). */
  shared: boolean;
  /** The nearest ancestor the admin can read (the place this one nests under); absent for a root. */
  parentId?: string;
  /** The kinds that extend this type (and that the admin can read): collections first, then by label. */
  children: Place[];
};

/**
 * The places the admin may read, from the model registry, as a tree: a type that extends another nests under
 * it. At each level collections come first, then single types, by label. Models are data (CONTRIBUTING.md
 * rule 2), so a model created a moment ago appears as soon as the registry refreshes. Returns the roots;
 * `flattenPlaces` lists every place.
 */
export const usePlaces = (): Place[] | undefined => {
  const { data: me } = useMe();
  const { resolved } = useResolvedDefinitions();
  const counts = useContentCounts();
  useModelPermissionsRefresh(resolved?.definitions);
  return useMemo(() => {
    if (!resolved) {
      return undefined;
    }
    const sources = resolved.definitions.flatMap(({ definition, scope }): PlaceSource[] =>
      isModelDefinition(definition) && canOnModel(me, definition.id, 'read')
        ? [
            {
              id: definition.id,
              apiKey: definition.apiKey,
              label: definition.label,
              kind: definition.kind,
              count: definition.kind === 'collection' ? counts?.get(definition.id) : undefined,
              canCreate: canOnModel(me, definition.id, 'create'),
              shared: scope === 'network',
            },
          ]
        : [],
    );
    return buildPlaceTree(sources, resolved.index.ancestors);
  }, [resolved, counts, me]);
};
