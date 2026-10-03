import { fieldIndexName } from '../../content/compiler/expressions.js';
import type { Database } from '../../db/index.js';
import type { JobHandler } from '../../jobs/types.js';
import * as schemaModelsRepository from '../../repositories/schemaModels.js';
import { readStoredDefinition } from '../storedDefinition.js';
import { buildFieldIndex, dropFieldIndex } from './indexes.js';
import { indexSpecOf, indexStepsOf } from './plan.js';

/**
 * `schema.fieldIndexLayout` (sites plan §H, index layout v2): rebuilds every active field index in the
 * current layout (`site_id` leading), then drops the index of the layout before sites. Enqueued once by the
 * migration that introduced the layout, and only when such indexes exist. Each build is `CONCURRENTLY` and
 * idempotent, so a retried job resumes where it stopped; the old index serves queries until its replacement
 * is valid. Only the old-layout names of active fields are dropped, never indexes found by pattern, so an
 * index a schema change is building right now is never touched.
 */
export const FIELD_INDEX_LAYOUT_JOB = 'schema.fieldIndexLayout';

export const createFieldIndexLayoutHandler =
  (db: Database): JobHandler =>
  async (context) => {
    const definitions = (await schemaModelsRepository.findActiveDefinitions(db)).map((row) =>
      readStoredDefinition(row.definition),
    );
    let rebuilt = 0;
    for (const step of definitions.flatMap((definition) => indexStepsOf(definition))) {
      await buildFieldIndex(db, step, context.log);
      await dropFieldIndex(db, fieldIndexName(indexSpecOf(step), 1));
      rebuilt += 1;
    }
    context.log.info({ rebuilt }, 'field indexes moved to the site-leading layout');
    return { rebuilt };
  };
