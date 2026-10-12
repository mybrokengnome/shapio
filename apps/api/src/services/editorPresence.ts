import { matchesRowFilter } from '../content/compiler/policy.js';
import * as adminUsersRepository from '../repositories/adminUsers.js';
import * as editorPresenceRepository from '../repositories/editorPresence.js';
import type { ActivePresenceRow } from '../repositories/editorPresence.js';
import * as entriesRepository from '../repositories/entries.js';
import * as entryHeadsRepository from '../repositories/entryHeads.js';
import { requireAdminPrincipal } from './auth.js';
import { assertEntryVisible, modelWithPolicy, type ContentServiceContext } from './contentAccess.js';

/**
 * Who has an entry open (plan editor-experience §9). Advisory only: entries lock nothing and conflicts stay
 * with the version guard. The admin sends a heartbeat every 15s while the document is visible; a tab not
 * seen for PRESENCE_TTL_MS is gone. Stored in a table, so every server process sees the same people.
 */
export const PRESENCE_TTL_MS = 45_000;

export type PresencePersonView = {
  userId: string;
  name: string;
  locale: string | null;
  since: string;
  you: boolean;
};

/**
 * A locale's draft as the server has it, so an open document learns that a save elsewhere moved it.
 * `savedBy` is null when the name isn't reliable: an autosave (it moves the head, not the revision and its
 * author), an author that is not an admin (token, schedule), or an admin who no longer exists.
 */
export type DraftStateView = {
  locale: string;
  version: number;
  savedAt: string;
  savedBy: { name: string; you: boolean } | null;
};

const since = (now: Date) => new Date(now.getTime() - PRESENCE_TTL_MS);

/** People other than the calling tab; several tabs of one person count once (their earliest). */
const toPeople = (rows: readonly ActivePresenceRow[], self: { userId: string; tabId?: string }) => {
  const people = new Map<string, PresencePersonView>();
  for (const row of rows) {
    if (row.admin_user_id === self.userId && row.tab_id === self.tabId) {
      continue;
    }
    if (!people.has(row.admin_user_id)) {
      people.set(row.admin_user_id, {
        userId: row.admin_user_id,
        name: row.name,
        locale: row.locale,
        since: row.started_at.toISOString(),
        you: row.admin_user_id === self.userId,
      });
    }
  }
  return [...people.values()];
};

const visibleEntry = async (context: ContentServiceContext, modelKey: string, id: string) => {
  const { model, policy } = await modelWithPolicy(context, modelKey, 'read');
  assertEntryVisible(
    policy,
    context.actor,
    await entriesRepository.findLive(id, model.definition.id, context.site.id, context.db),
    id,
  );
  return model;
};

const draftStates = async (
  context: ContentServiceContext,
  entryId: string,
  adminUserId: string,
): Promise<DraftStateView[]> => {
  const drafts = await entryHeadsRepository.findDraftsWithAuthors(entryId, context.db);
  const named = drafts.filter((draft) => !draft.autosaved_at && draft.author_type === 'admin');
  const authorIds = [
    ...new Set(named.map((draft) => draft.author_id).filter((id): id is string => id !== null)),
  ];
  const names = new Map(
    (await adminUsersRepository.findNamesByIds(authorIds, context.db)).map((user) => [user.id, user.name]),
  );
  return drafts.map((draft) => {
    const name = named.includes(draft) && draft.author_id ? names.get(draft.author_id) : undefined;
    return {
      locale: draft.locale,
      version: draft.version,
      savedAt: draft.updated_at.toISOString(),
      savedBy: name === undefined ? null : { name, you: draft.author_id === adminUserId },
    };
  });
};

export const heartbeat = async (
  context: ContentServiceContext,
  modelKey: string,
  id: string,
  input: { tabId: string; locale?: string | null },
  now = new Date(),
) => {
  const principal = requireAdminPrincipal(context.actor);
  const model = await visibleEntry(context, modelKey, id);
  await editorPresenceRepository.touch(
    {
      entryId: id,
      modelId: model.definition.id,
      adminUserId: principal.adminUserId,
      tabId: input.tabId,
      locale: input.locale ?? null,
      now,
    },
    context.db,
  );
  const [rows, drafts] = await Promise.all([
    editorPresenceRepository.listActiveForEntry(id, since(now), context.db),
    draftStates(context, id, principal.adminUserId),
  ]);
  return { people: toPeople(rows, { userId: principal.adminUserId, tabId: input.tabId }), drafts };
};

export const entryPresence = async (context: ContentServiceContext, modelKey: string, id: string) => {
  const principal = requireAdminPrincipal(context.actor);
  await visibleEntry(context, modelKey, id);
  const rows = await editorPresenceRepository.listActiveForEntry(id, since(new Date()), context.db);
  return { people: toPeople(rows, { userId: principal.adminUserId }) };
};

/** Everyone editing entries of a model, for list rows; entries outside the caller's row filter are left out. */
export const modelPresence = async (context: ContentServiceContext, modelKey: string) => {
  const principal = requireAdminPrincipal(context.actor);
  const { model, policy } = await modelWithPolicy(context, modelKey, 'read');
  const rows = (
    await editorPresenceRepository.listActiveForModel(model.definition.id, since(new Date()), context.db)
  ).filter((row) => matchesRowFilter(policy.rowFilter, context.actor, row));
  const byEntry = new Map<string, ActivePresenceRow[]>();
  rows.forEach((row) => byEntry.set(row.entry_id, [...(byEntry.get(row.entry_id) ?? []), row]));
  return {
    entries: [...byEntry].map(([entryId, entryRows]) => ({
      entryId,
      people: toPeople(entryRows, { userId: principal.adminUserId }),
    })),
  };
};

/** The tab closed the document. Removing someone else's row is impossible: the key includes the caller. */
export const leave = async (context: ContentServiceContext, id: string, tabId: string) => {
  const principal = requireAdminPrincipal(context.actor);
  await editorPresenceRepository.remove(
    { entryId: id, adminUserId: principal.adminUserId, tabId },
    context.db,
  );
};
