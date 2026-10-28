import type {
  AddChangeSetEntryInput,
  ApprovalNoteInput,
  ApprovalStatus,
  ChangeSet,
  CreateChangeSetInput,
  PutSchemaDraftInput,
  RequestChangesInput,
  ScheduleChangeSetInput,
  ShipChangeSetInput,
  UpdateChangeSetInput,
} from '@shapio/client';
import { ShapioApiError } from '@shapio/client';
import { categoryOfKind, type SchemaDefinition } from '@shapio/schema';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { PUBLISHING_POLL_INTERVAL_MS } from '@/constants/publishing';
import { logError } from '@/helpers/reportError';
import { adminApi } from './client';
import { invalidateAllEntries } from './content';
import { withCsrf } from './csrf';
import { queryKeys } from './queryKeys';

const changeSetsApi = adminApi.changeSets;

const silent = { silent: true } as const;

/** Every set that still matters on the Changes page (shipped and discarded ones live in the ledger). */
export const ACTIVE_CHANGE_SET_STATUSES = 'open,scheduled,shipping,failed';

/** Sets in these statuses, optionally only those in one approval state (plan approval). */
export const useChangeSets = (status: string = ACTIVE_CHANGE_SET_STATUSES, approval?: ApprovalStatus) =>
  useQuery({
    queryKey: queryKeys.develop.changeSets.list(status, approval),
    queryFn: () => changeSetsApi.list({ status, limit: 100, ...(approval ? { approval } : {}) }),
    meta: silent,
  });

const pollWhileShipping = (set: ChangeSet | undefined) =>
  set?.status === 'shipping' ? PUBLISHING_POLL_INTERVAL_MS : false;

/** One set, polled while it ships in the background (prerequisites running). */
/** A ship publishes entries: once a set has shipped, every list and cached entry is out of date. */
const refreshEntriesIfShipped = (
  queryClient: QueryClient,
  set: ChangeSet,
  before: Pick<ChangeSet, 'status'> | undefined,
) =>
  set.status === 'shipped' && before?.status !== 'shipped' ? invalidateAllEntries(queryClient) : undefined;

/** Polled while it ships; the entries it published are refreshed when it finishes. */
export const useChangeSet = (id: string) => {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: queryKeys.develop.changeSets.set(id),
    queryFn: async () => {
      const before = queryClient.getQueryData<ChangeSet>(queryKeys.develop.changeSets.set(id));
      const set = await changeSetsApi.get(id);
      // Only a ship seen running here: a set first loaded as shipped changed nothing just now.
      if (before?.status === 'shipping') {
        void refreshEntriesIfShipped(queryClient, set, before);
      }
      return set;
    },
    refetchInterval: (query) => pollWhileShipping(query.state.data),
    meta: silent,
  });
};

/**
 * The review (diffs, planner results, consumers, checks). Not refetched on focus: a strict ship needs a stable
 * view. Fetched again when the set's status changes (a shipped set's review is what it shipped); the set's
 * previous review stays on screen meanwhile.
 */
export const useChangeSetReview = (set: Pick<ChangeSet, 'id' | 'status'>) =>
  useQuery({
    queryKey: queryKeys.develop.changeSets.review(set.id, set.status),
    queryFn: () => changeSetsApi.review(set.id),
    placeholderData: (previous) => (previous?.changeSet.id === set.id ? previous : undefined),
    refetchOnWindowFocus: false,
    meta: silent,
  });

export const useChangeSetTimeline = (id: string) =>
  useQuery({
    queryKey: queryKeys.develop.changeSets.timeline(id),
    queryFn: () => changeSetsApi.timeline(id),
    meta: silent,
  });

/** Entry drafts not in any open set. */
export const useUnassignedEntries = () =>
  useQuery({
    queryKey: queryKeys.develop.changeSets.unassigned,
    queryFn: () => changeSetsApi.unassigned({ limit: 100 }),
    meta: silent,
  });

/**
 * Every write answers with the whole set: it replaces the cached set, and the lists, the review and the
 * timeline are refreshed (the review is what a strict ship is checked against).
 */
const useChangeSetWrite = <TVariables>(
  action: string,
  call: (variables: TVariables) => Promise<ChangeSet>,
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ['changeSets', action],
    meta: silent,
    mutationFn: (variables: TVariables) => withCsrf(() => call(variables)),
    onSuccess: (set) => {
      const before = queryClient.getQueryData<ChangeSet>(queryKeys.develop.changeSets.set(set.id));
      queryClient.setQueryData(queryKeys.develop.changeSets.set(set.id), set);
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.develop.changeSets.all }),
        refreshEntriesIfShipped(queryClient, set, before),
      ]);
    },
  });
};

export const useCreateChangeSet = () =>
  useChangeSetWrite('create', (input: CreateChangeSetInput) => changeSetsApi.create(input));

/** 409 when `expectedVersion` is stale. */
export const useUpdateChangeSet = () =>
  useChangeSetWrite('update', ({ id, input }: { id: string; input: UpdateChangeSetInput }) =>
    changeSetsApi.update(id, input),
  );

export const useDiscardChangeSet = () =>
  useChangeSetWrite('discard', (id: string) => changeSetsApi.discard(id));

export const useAddChangeSetEntry = () =>
  useChangeSetWrite('addEntry', ({ id, input }: { id: string; input: AddChangeSetEntryInput }) =>
    changeSetsApi.addEntry(id, input),
  );

export const useRemoveChangeSetItem = () =>
  useChangeSetWrite('removeItem', ({ id, itemId }: { id: string; itemId: string }) =>
    changeSetsApi.removeItem(id, itemId),
  );

/** Resolves with the set: `shipped`/`failed` inline, or `shipping` (prerequisites run; the set is polled). */
export const useShipChangeSet = () =>
  useChangeSetWrite('ship', ({ id, input }: { id: string; input: ShipChangeSetInput }) =>
    changeSetsApi.ship(id, input),
  );

export const useScheduleChangeSet = () =>
  useChangeSetWrite('schedule', ({ id, input }: { id: string; input: ScheduleChangeSetInput }) =>
    changeSetsApi.schedule(id, input),
  );

export const useUnscheduleChangeSet = () =>
  useChangeSetWrite('unschedule', (id: string) => changeSetsApi.unschedule(id));

/** Approval (plan approval): none of these change the set's version. */
export const useRequestApproval = () =>
  useChangeSetWrite('requestApproval', ({ id, input }: { id: string; input: ApprovalNoteInput }) =>
    changeSetsApi.requestApproval(id, input),
  );

export const useApproveChangeSet = () =>
  useChangeSetWrite('approve', ({ id, input }: { id: string; input: ApprovalNoteInput }) =>
    changeSetsApi.approve(id, input),
  );

export const useRequestChanges = () =>
  useChangeSetWrite('requestChanges', ({ id, input }: { id: string; input: RequestChangesInput }) =>
    changeSetsApi.requestChanges(id, input),
  );

export const useClearApproval = () =>
  useChangeSetWrite('clearApproval', (id: string) => changeSetsApi.clearApproval(id));

/** The newest open change set (with its items), or a new one named `title` when none is open. */
const openOrCreateChangeSet = async (title: string) => {
  const open = await changeSetsApi.list({ status: 'open', limit: 1 });
  const target = open.items[0] ?? (await changeSetsApi.create({ title, source: 'builder' }));
  return changeSetsApi.get(target.id);
};

/**
 * The builder's "Review in a change set": saves the schema draft into the newest open set (or a new one
 * named `newSetTitle`), replacing that set's earlier draft of the same definition, and resolves with the
 * set's ID so the caller can open its review.
 */
export const useSaveDraftToChangeSet = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ['changeSets', 'saveDraft'],
    meta: silent,
    mutationFn: ({
      definitionId,
      input,
      newSetTitle,
    }: {
      definitionId: string;
      input: Omit<PutSchemaDraftInput, 'expectedDraftVersion'>;
      newSetTitle: string;
    }) =>
      withCsrf(async () => {
        const set = await openOrCreateChangeSet(newSetTitle);
        const existing = set.items.find(
          (item) => item.kind === 'schema' && item.definitionId === definitionId,
        );
        await changeSetsApi.putSchemaDraft(set.id, definitionId, {
          ...input,
          ...(existing?.kind === 'schema' ? { expectedDraftVersion: existing.draftVersion } : {}),
        });
        return set.id;
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.develop.changeSets.all }),
  });
};

/**
 * New definitions proposed together ("Describe it"): each saved as a schema draft into the newest open set
 * (or a new one named `newSetTitle`), in the order given (references first). Resolves with the set's ID.
 */
export const useSaveNewDefinitionsToChangeSet = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ['changeSets', 'saveNewDefinitions'],
    meta: silent,
    mutationFn: ({
      definitions,
      newSetTitle,
    }: {
      definitions: readonly SchemaDefinition[];
      newSetTitle: string;
    }) =>
      withCsrf(async () => {
        const set = await openOrCreateChangeSet(newSetTitle);
        for (const definition of definitions) {
          // One at a time: a later definition may reference an earlier one.
          await changeSetsApi.putSchemaDraft(set.id, definition.id, {
            category: categoryOfKind(definition.kind),
            definition,
            baseVersion: null,
          });
        }
        return set.id;
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.develop.changeSets.all }),
  });
};

/** One definition's proposed state in a change set, based on its active version (null: a new one). */
export type ProposedDefinition = { definition: SchemaDefinition; baseVersion: number | null };

/**
 * "Add "image" to these 3 types" (plan interfaces decision 4): a new change set holding the interface's
 * draft and each member's draft with the missing contract field added, so they ship together. The members
 * go in first: the interface's draft is validated against the set's other drafts, and only passes once
 * every member has the field. A refused draft discards the set it just created, so nothing is left
 * behind. Resolves with the set's ID.
 */
export const useSaveContractFixToChangeSet = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ['changeSets', 'saveContractFix'],
    meta: silent,
    mutationFn: ({
      title,
      contract,
      members,
    }: {
      title: string;
      contract: ProposedDefinition;
      members: readonly ProposedDefinition[];
    }) =>
      withCsrf(async () => {
        const created = await changeSetsApi.create({ title, source: 'builder' });
        try {
          for (const { definition, baseVersion } of [...members, contract]) {
            await changeSetsApi.putSchemaDraft(created.id, definition.id, {
              category: categoryOfKind(definition.kind),
              definition,
              baseVersion,
            });
          }
        } catch (error) {
          await changeSetsApi
            .discard(created.id)
            .catch((cause: unknown) => logError(cause, 'discarding a change set the builder could not fill'));
          throw error;
        }
        return created.id;
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.develop.changeSets.all }),
  });
};

/** The schema draft of one item, for the before/after of a schema diff card. */
export const useSchemaDraft = (id: string, definitionId: string) =>
  useQuery({
    queryKey: queryKeys.develop.changeSets.draft(id, definitionId),
    queryFn: () => changeSetsApi.getSchemaDraft(id, definitionId),
    meta: silent,
  });

type ShipDraftNowInput = {
  definitionId: string;
  input: Omit<PutSchemaDraftInput, 'expectedDraftVersion'>;
  acknowledgement: Pick<ShipChangeSetInput, 'acknowledgeBreaking' | 'acknowledgeDestructive'>;
  title: string;
};

/** A set that ended `failed` as the request's error, so the caller shows the reason like any other. */
const failureOf = (set: ChangeSet) =>
  new ShapioApiError(422, {
    error: { code: set.error?.code ?? 'CHANGE_SET_FAILED', message: set.error?.message ?? set.title },
  });

/**
 * The builder's "Ship now" (plan developer-face §5): a one-item change set holding the schema draft,
 * shipped at once. Resolves with the set: `shipped`, or `shipping` while prerequisites run in the
 * background (its schema change shows in the builder as a pending change). A refused ship discards the
 * set it just created, so nothing is left behind; a ship that ran and failed keeps the set as history.
 */
export const useShipDraftNow = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ['changeSets', 'shipDraftNow'],
    meta: silent,
    mutationFn: ({ definitionId, input, acknowledgement, title }: ShipDraftNowInput) =>
      withCsrf(async () => {
        const created = await changeSetsApi.create({ title, source: 'builder' });
        let shipped: ChangeSet;
        try {
          await changeSetsApi.putSchemaDraft(created.id, definitionId, input);
          const set = await changeSetsApi.get(created.id);
          shipped = await changeSetsApi.ship(set.id, { expectedVersion: set.version, ...acknowledgement });
        } catch (error) {
          await changeSetsApi
            .discard(created.id)
            .catch((cause: unknown) => logError(cause, 'discarding a change set the builder could not ship'));
          throw error;
        }
        if (shipped.status === 'failed') {
          throw failureOf(shipped);
        }
        return shipped;
      }),
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.develop.changeSets.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.schema.all }),
      ]),
  });
};
