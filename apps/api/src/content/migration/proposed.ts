import type { Kysely, Transaction } from 'kysely';
import type { DB } from '../../db/types.js';
import * as localesRepository from '../../repositories/locales.js';
import * as schemaChangeJobsRepository from '../../repositories/schemaChangeJobs.js';
import * as schemaModelsRepository from '../../repositories/schemaModels.js';
import { toActiveDefinitions, toLocaleDefinition } from '../../schema/loadSnapshot.js';
import { buildNetworkSchema, type ActiveDefinition, type NetworkSchema } from '../../schema/snapshot.js';
import { readStoredRevision } from '../../schema/storedDefinition.js';

type Executor = Kysely<DB> | Transaction<DB>;

/**
 * The schema a prerequisite step checks content against: the active schema with the owner's pending
 * revision (the change being prepared) swapped in, and, when the change belongs to a change set, every other
 * pending revision of that set too (a model and the component it embeds can ship together). Steps only carry
 * IDs, so the definitions come from the in-flight schema changes; without one, the active schema is used.
 */
export const loadProposedSnapshot = async (executor: Executor, ownerId: string): Promise<NetworkSchema> => {
  const active = await toActiveDefinitions(await schemaModelsRepository.findActiveDefinitions(executor));
  const locales = (await localesRepository.list(executor)).map(toLocaleDefinition);
  const change = await schemaChangeJobsRepository.findInFlight({ type: 'model', id: ownerId }, executor);
  const changes = change?.change_set_id
    ? await schemaChangeJobsRepository.listInFlightForChangeSet(change.change_set_id, executor)
    : change
      ? [change]
      : [];
  const proposed: ActiveDefinition[] = [];
  for (const pending of changes) {
    const revision = pending.to_revision_id
      ? await schemaModelsRepository.findRevisionById(pending.to_revision_id, executor)
      : undefined;
    if (revision) {
      const model = await schemaModelsRepository.findModelById(revision.model_id, executor);
      proposed.push({
        ...(await readStoredRevision(revision.definition, revision.hash)),
        siteId: model?.site_id ?? null,
        version: revision.version,
        revisionId: revision.id,
        activatedAt: revision.created_at,
      });
    }
  }
  // A set's deletions have no revision: their definitions leave the proposed schema.
  const removed = new Set(
    changes.filter((pending) => !pending.to_revision_id).map((pending) => pending.target_id),
  );
  const replaced = new Set(proposed.map((entry) => entry.definition.id));
  return buildNetworkSchema(
    -1,
    [
      ...active.filter((entry) => !replaced.has(entry.definition.id) && !removed.has(entry.definition.id)),
      ...proposed,
    ],
    locales,
  );
};
