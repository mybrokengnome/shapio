import type { FastifyBaseLogger } from 'fastify';
import type { Database } from '../db/index.js';
import * as entryHeadsRepository from '../repositories/entryHeads.js';
import * as uniqueValuesRepository from '../repositories/uniqueValues.js';
import type { SchemaContentPorts } from '../schema/planner/contentPorts.js';
import type { FollowUpStep } from '../schema/planner/steps.js';
import { countLocaleRemoval, purgeLocale } from './localePurge.js';
import { applyChange } from './migration/apply.js';
import { discardStaged } from './migration/checks.js';
import { dryRun } from './migration/dryRun.js';
import { assessStep } from './migration/impact.js';

/**
 * Content storage as the schema planner sees it (ADR 0002 "Contracts for later packages"): impact counts,
 * the resumable dry run of a change's content steps, the delta re-check and rewrite inside the activation
 * transaction, the release of staged work after a failure, and post-activation follow-ups. Replaces
 * NO_CONTENT_PORTS.
 */

const runFollowUp = async (database: Database, step: FollowUpStep, log: FastifyBaseLogger): Promise<void> => {
  switch (step.kind) {
    case 'releaseUnique':
      // Only the members that lose the field (a parent keeps its rows when a child moves away); a plan
      // made before inheritance names no models, which means every model's rows.
      await uniqueValuesRepository.removeForField(step.fieldId, step.modelIds ?? null, database);
      return;
    case 'purgeLocale':
      log.info(
        { locale: step.code, ...(await purgeLocale(database, step.code)) },
        'purged the content of a deleted locale',
      );
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
    assess: (step, steps) => assessStep(database, step, steps),
    countLocaleRemoval: (code) => countLocaleRemoval(database, code),
  },
});
