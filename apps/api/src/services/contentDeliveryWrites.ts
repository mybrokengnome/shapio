import type { ContentServiceContext } from './contentAccess.js';
import * as contentEntriesService from './contentEntries.js';
import type { AdminEntryView } from './contentReads.js';

/**
 * Writes through the delivery API (`POST/PUT/DELETE /api/content/:modelKey…`, build plan §4.I4): app users,
 * and anonymous callers where `public` grants it, create and change entries under their roles. The content
 * service does the work (validation, write masks, row filters, OCC, revisions); it records the app user as
 * the owner server-side, and `ownedByPrincipal` limits updates and deletes to their own entries.
 *
 * Responses carry the entry's identity and state only, never its values: the result of a write is a draft
 * (unless the model has no draft stage), and delivery never serves drafts, not even to their author.
 * Published values are read back through `GET /api/content/:modelKey/:id`.
 */
export type DeliveryWriteResult = {
  data: {
    id: string;
    locale: string;
    version: number;
    status: AdminEntryView['status'];
    createdAt: string;
    updatedAt: string;
    publishedAt: string | null;
  };
  meta: Record<string, never>;
};

const toResult = (view: AdminEntryView): DeliveryWriteResult => ({
  data: {
    id: view.id,
    locale: view.locale,
    version: view.version,
    status: view.status,
    createdAt: view.createdAt,
    updatedAt: view.updatedAt,
    publishedAt: view.publishedAt,
  },
  meta: {},
});

export type DeliveryCreateInput = { locale?: string; data?: unknown; publish?: boolean };

export const createDeliveryEntry = async (
  context: ContentServiceContext,
  modelKey: string,
  input: DeliveryCreateInput,
): Promise<DeliveryWriteResult> =>
  toResult(await contentEntriesService.createEntry(context, modelKey, input));

export type DeliveryUpdateInput = { locale?: string; expectedVersion: number | null; data?: unknown };

export const updateDeliveryEntry = async (
  context: ContentServiceContext,
  modelKey: string,
  id: string,
  input: DeliveryUpdateInput,
): Promise<DeliveryWriteResult> =>
  toResult(await contentEntriesService.updateEntry(context, modelKey, id, { ...input, autosave: false }));

export const deleteDeliveryEntry = (context: ContentServiceContext, modelKey: string, id: string) =>
  contentEntriesService.deleteEntry(context, modelKey, id);
