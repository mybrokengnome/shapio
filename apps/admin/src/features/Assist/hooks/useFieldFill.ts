import {
  ShapioApiError,
  type AcceptContentOpsResult,
  type ContentIssue,
  type SuggestedValue,
} from '@shapio/client';
import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { useAcceptContentOps } from '@/api/assist';
import { invalidateAllEntries } from '@/api/content';
import { queryKeys } from '@/api/queryKeys';
import { contentIssuesOf } from '@/fields/helpers/apiErrors';
import { logError } from '@/helpers/reportError';
import type { FillGroup } from '../helpers/fillGroups';

/** What happened to one entry locale's accept. `failed` and `invalid` can be tried again. */
export type FillOutcome =
  | { kind: 'saved'; changeSet: AcceptContentOpsResult['changeSet'] }
  | { kind: 'filledMeanwhile' }
  | { kind: 'unsavedWork' }
  | { kind: 'invalid'; issues: ContentIssue[] }
  | { kind: 'failed'; error: unknown };

type FillState = {
  /** The run these belong to: a new run starts over. */
  runId: string | undefined;
  /** Values the person edited, by proposal key (the proposed value otherwise). */
  drafts: Readonly<Record<string, SuggestedValue>>;
  /** Proposals left out of their group's accept, by key. */
  rejected: ReadonlySet<string>;
  /** By group key (entry locale). */
  outcomes: Readonly<Record<string, FillOutcome>>;
  /** Groups whose accept is queued or on its way. */
  pending: ReadonlySet<string>;
  /** The run's change set, once an accept named it. */
  changeSetId: string | null;
};

const emptyState = (runId: string | undefined): FillState => ({
  runId,
  drafts: {},
  rejected: new Set(),
  outcomes: {},
  pending: new Set(),
  changeSetId: null,
});

const without = (set: ReadonlySet<string>, key: string) => new Set([...set].filter((item) => item !== key));

const outcomeOf = (error: unknown): FillOutcome => {
  if (error instanceof ShapioApiError && error.code === 'ASSIST_FIELD_FILLED_MEANWHILE') {
    return { kind: 'filledMeanwhile' };
  }
  if (error instanceof ShapioApiError && error.code === 'ASSIST_DRAFT_HAS_UNSAVED_WORK') {
    return { kind: 'unsavedWork' };
  }
  const issues = contentIssuesOf(error);
  return issues.length > 0 ? { kind: 'invalid', issues } : { kind: 'failed', error };
};

const isEmptyValue = (value: SuggestedValue) =>
  Array.isArray(value) ? value.length === 0 : value.trim() === '';

/**
 * The person's review of a fill run (`requiredEmpty`, `fieldEmpty`): edited values, rejected fields, and one
 * accept per entry locale, which saves its remaining values into the entry's draft (and the run's change
 * set). Accepts run one after another. Kept outside the review sheet, so closing it loses nothing.
 */
export const useFieldFill = (runId: string | undefined) => {
  const queryClient = useQueryClient();
  const acceptMutation = useAcceptContentOps();
  const [stored, setState] = useState<FillState>(() => emptyState(runId));
  const state = stored.runId === runId ? stored : emptyState(runId);
  const queue = useRef<Promise<void>>(Promise.resolve());

  /** Changes this run's state (a state from an earlier run is dropped first). */
  const update = (change: (current: FillState) => FillState) =>
    setState((current) => change(current.runId === runId ? current : emptyState(runId)));

  const valueOf = (key: string, proposed: SuggestedValue) => state.drafts[key] ?? proposed;

  const accept = (group: FillGroup) => {
    if (!runId) {
      return;
    }
    const items = group.proposals
      .filter((proposal) => !state.rejected.has(proposal.key))
      .map((proposal) => ({ key: proposal.key, value: valueOf(proposal.key, proposal.proposedValue) }));
    if (items.length === 0) {
      return;
    }
    update((current) => ({ ...current, pending: new Set([...current.pending, group.key]) }));
    queue.current = queue.current.then(async () => {
      try {
        const result = await acceptMutation.mutateAsync({ runId, input: { items } });
        update((current) => ({
          ...current,
          pending: without(current.pending, group.key),
          outcomes: { ...current.outcomes, [group.key]: { kind: 'saved', changeSet: result.changeSet } },
          changeSetId: result.changeSet.id ?? current.changeSetId,
        }));
      } catch (error) {
        logError(error, `accepting proposed values for ${group.key}`);
        update((current) => ({
          ...current,
          pending: without(current.pending, group.key),
          outcomes: { ...current.outcomes, [group.key]: outcomeOf(error) },
        }));
      }
    });
  };

  return {
    valueOf,
    setDraft: (key: string, value: SuggestedValue) =>
      update((current) => ({ ...current, drafts: { ...current.drafts, [key]: value } })),
    isRejected: (key: string) => state.rejected.has(key),
    toggleRejected: (key: string) =>
      update((current) => ({
        ...current,
        rejected: current.rejected.has(key)
          ? without(current.rejected, key)
          : new Set([...current.rejected, key]),
      })),
    outcomeOf: (group: FillGroup): FillOutcome | undefined => state.outcomes[group.key],
    isPending: (group: FillGroup) => state.pending.has(group.key),
    /** Some field the group would send is empty: nothing to save for it. */
    hasEmptyValue: (group: FillGroup) =>
      group.proposals.some(
        (proposal) =>
          !state.rejected.has(proposal.key) && isEmptyValue(valueOf(proposal.key, proposal.proposedValue)),
      ),
    accept,
    changeSetId: state.changeSetId,
    /**
     * After the review: saved values resolve findings and change entries and the change set, so those are
     * read again (not during the review, which would unmount the Inbox group and this list).
     */
    finishReview: () => {
      if (Object.values(state.outcomes).some((outcome) => outcome.kind === 'saved')) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.contentHealth.all });
        void queryClient.invalidateQueries({ queryKey: queryKeys.develop.changeSets.all });
        void invalidateAllEntries(queryClient);
      }
    },
  };
};

export type FieldFill = ReturnType<typeof useFieldFill>;
