import type { FastifyBaseLogger } from 'fastify';
import type { Database } from '../db/index.js';
import * as contentPurgeRepository from '../repositories/contentPurge.js';
import * as contentRevisionsRepository from '../repositories/contentRevisions.js';
import * as entriesRepository from '../repositories/entries.js';
import * as entryHeadsRepository from '../repositories/entryHeads.js';
import * as publicationsRepository from '../repositories/publications.js';
import * as uniqueValuesRepository from '../repositories/uniqueValues.js';
import type { SchemaContentPorts } from '../schema/planner/contentPorts.js';
import type { FollowUpStep } from '../schema/planner/steps.js';
import { applyChange } from './migration/apply.js';
import { discardStaged, stepModelIds } from './migration/checks.js';
import { dryRun } from './migration/dryRun.js';

/**
 * Content storage as the schema planner sees it (ADR 0002 "Contracts for later packages"): impact counts,
 * the resumable dry run of a change's content steps, the delta re-check and rewrite inside the activation
 * transaction, the release of staged work after a failure, and post-activation follow-ups. Replaces
 * NO_CONTENT_PORTS.
 */

/** Deletes a removed locale's content: publication history, heads (edges cascade), registry rows, revisions. */
const purgeLocale = (database: Database, code: string) =>
  database.transaction().execute(async (trx) => {
    await publicationsRepository.removeForLocale(code, trx);
    await contentPurgeRepository.removeMediaReferencesForLocale(code, trx);
    await entryHeadsRepository.removeForLocale(code, trx);
    await uniqueValuesRepository.removeForLocale(code, trx);
    await contentRevisionsRepository.deleteForLocale(code, trx);
    // Entries that existed only in that locale are gone with it.
    await entriesRepository.softDeleteHeadless(null, new Date(), trx);
  });

const runFollowUp = async (database: Database, step: FollowUpStep, log: FastifyBaseLogger): Promise<void> => {
  switch (step.kind) {
    case 'releaseUnique':
      await uniqueValuesRepository.removeForField(step.fieldId, database);
      return;
    case 'purgeLocale':
      await purgeLocale(database, step.code);
      log.info({ locale: step.code }, 'purged the content of a deleted locale');
      return;
    default:
      log.warn({ step: step.kind }, 'content ports received a follow-up they do not handle');
  }
};

export const createContentPorts = (database: Database): SchemaContentPorts => ({
  migration: {
    run: (steps, context) => dryRun(database, steps, context),
    apply: applyChange,
    discard: (steps) => discardStaged(steps, database),
    runFollowUp: (step, log) => runFollowUp(database, step, log),
  },
  impact: {
    countHeads: (modelIds) => entryHeadsRepository.countForModels(modelIds, database),
    assess: async (step) => ({
      affectedHeads: await entryHeadsRepository.countForModels(stepModelIds(step), database),
    }),
    countLocaleHeads: (code) => entryHeadsRepository.countForLocale(code, database),
  },
});
