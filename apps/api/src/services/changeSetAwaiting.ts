import { AWAITING_ME_SCAN_LIMIT } from '../constants/approval.js';
import * as changeSetsRepository from '../repositories/changeSets.js';
import type { ChangeSetListRow } from '../repositories/changeSets.js';
import { loadApprovalSummaries, type ChangeSetApprovalSummaryView } from './changeSetApprovalViews.js';
import { actorNamesFor } from './changeSetViews.js';
import type { ContentServiceContext } from './contentAccess.js';

/**
 * `awaitingMe=true` (plan approval-workflows): the sets in review the caller can sign off now. Eligibility
 * depends on the frozen workflow, the caller's roles and who signed already, so the list scans requested
 * sets page by page and keeps the eligible ones. A call scans at most AWAITING_ME_SCAN_LIMIT sets; the
 * cursor is the last set scanned (never rescanned), so a page can be short and still have a next cursor.
 */
export type AwaitingPage = {
  rows: ChangeSetListRow[];
  approvals: Map<string, ChangeSetApprovalSummaryView>;
  names: Map<string, string>;
  /** The last set scanned, when more may follow (the next cursor). */
  continueAfter: ChangeSetListRow | null;
};

type ListFilter = Omit<Parameters<typeof changeSetsRepository.list>[0], 'limit' | 'after'>;

export const listAwaitingMe = async (
  context: ContentServiceContext,
  filter: ListFilter,
  limit: number,
  after: { createdAt: Date; id: string } | undefined,
): Promise<AwaitingPage> => {
  const page: AwaitingPage = { rows: [], approvals: new Map(), names: new Map(), continueAfter: null };
  let cursor = after;
  let scanned = 0;
  while (scanned < AWAITING_ME_SCAN_LIMIT) {
    const batchSize = Math.min(Math.max(limit * 2, 50), AWAITING_ME_SCAN_LIMIT - scanned);
    const batch = await changeSetsRepository.list(
      { ...filter, approvalStatuses: ['requested'], limit: batchSize, ...(cursor ? { after: cursor } : {}) },
      context.db,
    );
    scanned += batch.length;
    const names = await actorNamesFor(context.db, batch);
    const approvals = await loadApprovalSummaries(context, batch, names);
    for (const [index, row] of batch.entries()) {
      const approval = approvals.get(row.id);
      if (approval?.eligible) {
        page.rows.push(row);
        page.approvals.set(row.id, approval);
        names.forEach((name, id) => page.names.set(id, name));
      }
      if (page.rows.length === limit) {
        const more = index < batch.length - 1 || batch.length === batchSize;
        page.continueAfter = more ? row : null;
        return page;
      }
    }
    const last = batch.at(-1);
    if (batch.length < batchSize || !last) {
      page.continueAfter = null;
      return page;
    }
    cursor = { createdAt: last.created_at, id: last.id };
    page.continueAfter = last;
  }
  return page;
};
