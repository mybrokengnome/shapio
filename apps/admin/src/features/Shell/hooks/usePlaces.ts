import { useMemo } from 'react';
import { useMe } from '@/api/auth';
import { useContentCounts } from '@/api/contentCounts';
import { useDefinitions } from '@/api/schema';
import { canOnModel } from '@/helpers/modelPermissions';
import { useModelPermissionsRefresh } from './useModelPermissionsRefresh';

/** A content type as editors see it: a place in the sidebar. */
export type Place = {
  id: string;
  apiKey: string;
  label: string;
  kind: 'collection' | 'singleton';
  /** Entries the admin can read; undefined until counts load (or for single types, which need none). */
  count: number | undefined;
  canCreate: boolean;
  /** Shared with all sites (rather than this site's own). */
  shared: boolean;
};

const KIND_ORDER = { collection: 0, singleton: 1 } as const;

/**
 * The places the admin may read, from the model registry: collections, then single types, by label. Models
 * are data (CONTRIBUTING.md rule 2), so a model created a moment ago appears as soon as the registry refreshes.
 */
export const usePlaces = (): Place[] | undefined => {
  const { data: me } = useMe();
  const { data: definitions } = useDefinitions('model');
  const counts = useContentCounts();
  useModelPermissionsRefresh(definitions);
  return useMemo(
    () =>
      definitions
        ?.flatMap(({ definition, scope }): Place[] =>
          definition.kind !== 'component' && canOnModel(me, definition.id, 'read')
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
        )
        .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.label.localeCompare(b.label)),
    [definitions, counts, me],
  );
};
