import type { Place } from '../hooks/usePlaces';

/** A readable place before nesting. */
export type PlaceSource = Omit<Place, 'children' | 'parentId'>;

const KIND_ORDER = { collection: 0, singleton: 1 } as const;

const byKindThenLabel = (a: Place, b: Place) =>
  KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.label.localeCompare(b.label);

/**
 * Nests readable places under their nearest readable ancestor (`ancestors`: root first) and sorts every level
 * (collections, then single types, by label). A kind whose every ancestor is unreadable becomes a root.
 * Returns the roots.
 */
export const buildPlaceTree = (
  sources: readonly PlaceSource[],
  ancestors: (id: string) => readonly string[],
): Place[] => {
  const readable = new Map(sources.map((source) => [source.id, source]));
  const children = new Map<string | undefined, PlaceSource[]>();
  const parentOf = new Map<string, string | undefined>();
  for (const source of sources) {
    const parentId = [...ancestors(source.id)].reverse().find((id) => readable.has(id));
    parentOf.set(source.id, parentId);
    children.set(parentId, [...(children.get(parentId) ?? []), source]);
  }
  const build = (source: PlaceSource): Place => {
    const parentId = parentOf.get(source.id);
    return {
      ...source,
      children: (children.get(source.id) ?? []).map(build).sort(byKindThenLabel),
      ...(parentId ? { parentId } : {}),
    };
  };
  return (children.get(undefined) ?? []).map(build).sort(byKindThenLabel);
};

/** Every place in tree order (each parent before its kinds). */
export const flattenPlaces = (places: readonly Place[]): Place[] =>
  places.flatMap((place) => [place, ...flattenPlaces(place.children)]);
