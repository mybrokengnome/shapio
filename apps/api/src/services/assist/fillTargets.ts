import { ASSIST_CONTENT_OPS_MAX_FINDINGS, ASSIST_FILL_SCAN_LIMIT } from '../../constants/assist.js';
import { isMissingValue } from '../../content/validator/index.js';
import { listFindings } from '../contentHealthReads.js';
import { listAdminEntries } from '../contentReads.js';
import type { AssistServiceContext } from './context.js';
import type { SuggestTarget } from './suggestTarget.js';

/** One entry locale of a fill run and the fields (JSON pointers in API IDs) to propose values for. */
export type FillGroup = { entryId: string; modelKey: string; locale: string; fieldPaths: string[] };

const PAGE_SIZE = 100;
const FINDINGS_PAGE = 200;

/** Adds a field to its entry locale's group, keeping the order groups were first seen in. */
const addTo = (groups: Map<string, FillGroup>, entry: Omit<FillGroup, 'fieldPaths'>, fieldPath: string) => {
  const key = `${entry.entryId}:${entry.locale}`;
  const group = groups.get(key) ?? { ...entry, fieldPaths: [] };
  if (!group.fieldPaths.includes(fieldPath)) {
    group.fieldPaths.push(fieldPath);
  }
  groups.set(key, group);
};

/**
 * `requiredEmpty`: the open findings of that health rule the actor may see (as the Inbox lists them), newest
 * first, grouped by entry locale; at most ASSIST_CONTENT_OPS_MAX_FINDINGS groups, each with all its fields.
 */
export const requiredEmptyGroups = async (
  context: AssistServiceContext,
  modelKey: string | null,
): Promise<FillGroup[]> => {
  const groups = new Map<string, FillGroup>();
  let cursor: string | undefined;
  do {
    const page = await listFindings(context, {
      rule: 'requiredEmpty',
      ...(modelKey ? { modelKey } : {}),
      ...(cursor ? { cursor } : {}),
      limit: FINDINGS_PAGE,
    });
    for (const finding of page.items) {
      if (finding.path) {
        addTo(groups, finding, finding.path);
      }
    }
    cursor = page.nextCursor ?? undefined;
    // One group past the cap means every capped group is complete (an entry's findings are listed together).
  } while (cursor && groups.size <= ASSIST_CONTENT_OPS_MAX_FINDINGS);
  return [...groups.values()].slice(0, ASSIST_CONTENT_OPS_MAX_FINDINGS);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The target's value in a list row's data (API IDs, as the admin list returns it). */
const listedValue = (data: Record<string, unknown>, target: SuggestTarget): unknown => {
  const top = data[target.topField.apiKey];
  return target.parent ? (isRecord(top) ? top[target.field.apiKey] : undefined) : top;
};

/**
 * `fieldEmpty`: the drafts of the content type (its kinds' included, as the admin list shows them) in `locale`
 * whose value at the target is missing, newest first, at most ASSIST_CONTENT_OPS_MAX_FINDINGS. A top-level field
 * is filtered by the query compiler (`$null`); a component's field in memory, reading at most
 * ASSIST_FILL_SCAN_LIMIT drafts (`scanCapped` when it stopped there). The job re-checks each draft.
 */
export const fieldEmptyGroups = async (
  context: AssistServiceContext,
  input: { modelKey: string; target: SuggestTarget; locale: string; localized: boolean },
): Promise<{ groups: FillGroup[]; scanCapped: boolean }> => {
  const { target } = input;
  const groups = new Map<string, FillGroup>();
  const filter = target.parent ? '' : `&filters[${target.topField.apiKey}][$null]=true`;
  const locale = input.localized ? `&locale=${encodeURIComponent(input.locale)}` : '';
  let scanned = 0;
  for (let page = 1; groups.size < ASSIST_CONTENT_OPS_MAX_FINDINGS; page += 1) {
    if (scanned >= ASSIST_FILL_SCAN_LIMIT) {
      return { groups: [...groups.values()], scanCapped: true };
    }
    const list = await listAdminEntries(
      context,
      input.modelKey,
      `sort=updatedAt:desc&pageSize=${PAGE_SIZE}&page=${page}${locale}${filter}`,
    );
    scanned += list.items.length;
    for (const item of list.items) {
      // A localized list falls back to another locale for entries without this one: those are not drafts here.
      const inLocale = !input.localized || item.locale === input.locale;
      if (inLocale && isMissingValue(listedValue(item.data, target))) {
        addTo(groups, { entryId: item.id, modelKey: item.model, locale: item.locale }, target.path);
      }
    }
    if (page >= list.pagination.pageCount) {
      break;
    }
  }
  return { groups: [...groups.values()].slice(0, ASSIST_CONTENT_OPS_MAX_FINDINGS), scanCapped: false };
};
