import type { ShapioClient } from '@shapio/client';
import { localeKey, type ImportMap } from './importMap.js';
import type { LiveSchema } from './values.js';

/**
 * The review step: every created entry locale that was published at the source becomes a `publish` item of
 * an open change set. Above `MAX_ITEMS_PER_SET` items the import opens numbered sets, so each stays
 * reviewable and shippable. Drafts at the source are not added: they stay drafts.
 */
export const MAX_ITEMS_PER_SET = 2000;

export type PublishItem = { key: string; modelKey: string; entryId: string; locale: string | null };

export type ChangeSetOutcome = { added: number; failed: Array<{ key: string; message: string }> };

/** Publish items that are not in a change set yet, in plan order. */
export const pendingPublishItems = (
  map: ImportMap,
  live: LiveSchema,
): { pending: PublishItem[]; total: number } => {
  const pending: PublishItem[] = [];
  let total = 0;
  for (const [sourceId, planned] of Object.entries(map.entries)) {
    const created = map.state.entries[sourceId];
    const view = live.byKey.get(planned.definition);
    for (const locale of planned.published) {
      total += 1;
      if (!created || !view || !created.locales.includes(localeKey(locale))) {
        continue;
      }
      const key = `${created.entryId}/${localeKey(locale)}`;
      if (!map.state.changeSetItems[key]) {
        pending.push({ key, modelKey: view.definition.apiKey, entryId: created.entryId, locale });
      }
    }
  }
  return { pending, total };
};

const setTitle = (label: string, index: number, count: number) =>
  count > 1 ? `Import from ${label} (${index}/${count})` : `Import from ${label}`;

/** The last set this import opened, when it is still open and has room. */
const reusableSet = async (client: ShapioClient, map: ImportMap) => {
  const last = map.state.changeSets.at(-1);
  if (!last) {
    return undefined;
  }
  const set = await client.admin.changeSets.get(last.id);
  return set.status === 'open' && set.entryItemCount < MAX_ITEMS_PER_SET
    ? { id: set.id, count: set.entryItemCount }
    : undefined;
};

export const addToChangeSets = async (
  client: ShapioClient,
  map: ImportMap,
  items: readonly PublishItem[],
  { label, total, save }: { label: string; total: number; save: () => Promise<void> },
): Promise<ChangeSetOutcome> => {
  const outcome: ChangeSetOutcome = { added: 0, failed: [] };
  const setCount = Math.max(1, Math.ceil(total / MAX_ITEMS_PER_SET));
  let current = await reusableSet(client, map);
  for (const item of items) {
    if (!current || current.count >= MAX_ITEMS_PER_SET) {
      const index = map.state.changeSets.length + 1;
      const title = setTitle(label, index, Math.max(setCount, index));
      const created = await client.admin.changeSets.create({
        title,
        description: `Imported entries that were published in ${label}. Review, then ship to publish them.`,
      });
      map.state.changeSets.push({ id: created.id, title });
      current = { id: created.id, count: 0 };
      await save();
    }
    try {
      await client.admin.changeSets.addEntry(current.id, {
        modelKey: item.modelKey,
        entryId: item.entryId,
        ...(item.locale ? { locale: item.locale } : {}),
        action: 'publish',
      });
      map.state.changeSetItems[item.key] = current.id;
      current.count += 1;
      outcome.added += 1;
      await save();
    } catch (error) {
      outcome.failed.push({ key: item.key, message: (error as Error).message });
    }
  }
  return outcome;
};

/** The admin page of a change set (`/admin/s/<site>/changes/<id>` on a named site). */
export const changeSetUrl = (baseUrl: string, id: string, site: string | null) =>
  `${baseUrl.replace(/\/+$/, '')}/admin/${site ? `s/${encodeURIComponent(site)}/` : ''}changes/${encodeURIComponent(id)}`;
