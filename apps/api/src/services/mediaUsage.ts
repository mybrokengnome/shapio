import { effectiveTitleField, isModelDefinition } from '@shapio/schema';
import { maskAllows, matchesRowFilter } from '../content/compiler/policy.js';
import type { Policy } from '../permissions/types.js';
import * as entriesRepository from '../repositories/entries.js';
import * as entryHeadsRepository from '../repositories/entryHeads.js';
import type { ContentServiceContext } from './contentAccess.js';
import { listUsagesOnSite, type MediaUsageView } from './mediaAssets.js';

/**
 * "Used in" for the admin: the entry heads that reference an asset, each named by its entry's title (the
 * draft's, in the usage's locale, else the default locale's), as the Inbox names entries. The title is
 * null unless the caller may read the model, the entry passes the read row filter and the read mask shows
 * the title field; the admin then shows the entry without a link.
 */
export type TitledMediaUsageView = MediaUsageView & { title: string | null };

const titleValue = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value : typeof value === 'number' ? String(value) : null;

const readPolicies = async (context: ContentServiceContext, modelIds: readonly string[]) => {
  const policies = new Map<string, Policy>();
  for (const modelId of modelIds) {
    const policy = await context.permissions.evaluate(context.actor, { action: 'read', modelId });
    if (policy.allowed) {
      policies.set(modelId, policy);
    }
  }
  return policies;
};

const titlesFor = async (context: ContentServiceContext, items: readonly MediaUsageView[]) => {
  const entryIds = [...new Set(items.map((item) => item.entryId))];
  const policies = await readPolicies(context, [...new Set(items.map((item) => item.modelId))]);
  const [entries, drafts] = await Promise.all([
    entriesRepository.findByIds(entryIds, context.db),
    entryHeadsRepository.findDraftsForEntries(entryIds, context.db),
  ]);
  const entryById = new Map(entries.map((entry) => [entry.id, entry]));
  return (item: MediaUsageView): string | null => {
    const policy = policies.get(item.modelId);
    // Effective fields: a kind's title may be inherited (plan polymorphic-types).
    const definition = context.snapshot.resolve(item.modelId);
    const entry = entryById.get(item.entryId);
    if (!policy || !entry || !definition || !isModelDefinition(definition)) {
      return null;
    }
    const field = effectiveTitleField(definition);
    if (
      !field ||
      !maskAllows(policy.readMask, field) ||
      !matchesRowFilter(policy.rowFilter, context.actor, entry)
    ) {
      return null;
    }
    const ofEntry = drafts.filter((draft) => draft.entry_id === item.entryId);
    const head =
      ofEntry.find((draft) => draft.locale === item.locale) ??
      ofEntry.find((draft) => draft.locale === context.snapshot.defaultLocale) ??
      ofEntry[0];
    return titleValue(head?.data?.[field.id]);
  };
};

/** `GET /api/admin/media/assets/:id/usage`: the usages with their entries' titles. */
export const listTitledUsages = async (
  context: ContentServiceContext,
  assetId: string,
): Promise<{ items: TitledMediaUsageView[]; total: number }> => {
  const { items, total } = await listUsagesOnSite(context.site, assetId);
  const titleOf = await titlesFor(context, items);
  return { items: items.map((item) => ({ ...item, title: titleOf(item) })), total };
};
