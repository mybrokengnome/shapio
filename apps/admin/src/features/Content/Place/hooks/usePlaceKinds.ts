import type { ResolvedModelDefinition } from '@shapio/schema';
import { useMemo } from 'react';
import { useMe } from '@/api/auth';
import { canOnModel } from '@/helpers/modelPermissions';
import { familyKindsOf } from '@/hooks/useResolvedDefinitions';
import type { ContentSchema } from '../../hooks/useContentSchema';

export type PlaceKinds = {
  /** The place's type and every kind that extends it, in tree order (the type first). */
  kinds: readonly ResolvedModelDefinition[];
  /** More than one kind: the list shows each row's kind and offers a Kind filter. */
  isFamily: boolean;
  /** The kinds the admin may create entries of, in the same order. */
  creatable: readonly ResolvedModelDefinition[];
  /** A row's own kind, by its singular API ID (the place's type for a kind it doesn't know). */
  kindOf: (modelKey: string) => ResolvedModelDefinition;
};

/** The place's family (plan polymorphic-types D13): its list holds every kind's entries. */
export const usePlaceKinds = (schema: ContentSchema, model: ResolvedModelDefinition): PlaceKinds => {
  const { data: me } = useMe();
  const kinds = useMemo(() => familyKindsOf(schema.models, schema.index, model.id), [schema, model.id]);
  return useMemo(() => {
    const byKey = new Map(kinds.map((kind) => [kind.apiKey, kind]));
    return {
      kinds,
      isFamily: kinds.length > 1,
      creatable: kinds.filter((kind) => canOnModel(me, kind.id, 'create')),
      kindOf: (modelKey) => byKey.get(modelKey) ?? model,
    };
  }, [kinds, model, me]);
};
