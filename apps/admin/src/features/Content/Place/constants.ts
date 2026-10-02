import type { EntryStatus } from '@shapio/client';
import type { SYSTEM_FILTER_FIELDS } from '../helpers/filterOperators';

/** The tabs of a place: its entries, then (with the schema permission) its structure and API. */
export const PLACE_TABS = ['entries', 'structure', 'api'] as const;
export type PlaceTab = (typeof PLACE_TABS)[number];

/** How a collection's entries are shown: a table, or cover tiles (models with a cover field only). */
export const LIST_VIEWS = ['table', 'cards'] as const;
export type ListView = (typeof LIST_VIEWS)[number];

/** Labels of the system attributes entries can be filtered and sorted by. */
export const SYSTEM_LABEL_KEYS = {
  createdAt: 'place.list.createdAt',
  updatedAt: 'place.list.updatedAt',
} as const satisfies Record<(typeof SYSTEM_FILTER_FIELDS)[number], string>;

/** How often list rows refresh who is editing them (the editor's heartbeat is 15s, its TTL 45s). */
export const PRESENCE_POLL_MS = 15_000;

/** Presence avatars shown on a row before "+N". */
export const MAX_ROW_PRESENCE = 3;

/** Entries a relation filter's picker lists while searching. */
export const RELATION_PICKER_SIZE = 8;

/** Entry states the list filters by (computed in the list's locale by the server). */
export const ENTRY_STATUSES = ['draft', 'modified', 'published'] as const satisfies readonly EntryStatus[];

/** Locales shown as flags on a row before "+N". */
export const MAX_ROW_LOCALES = 4;
