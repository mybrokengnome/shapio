import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { SERVER_STATE } from './constants';
import { queryDatabase } from './testDatabases';

type ServerState = { database: string };

/** Runs SQL against the e2e server's database (for fixtures the admin cannot create yet). */
const queryServerDatabase = <T extends Record<string, unknown>>(statement: string, parameters: unknown[]) => {
  const state = JSON.parse(readFileSync(SERVER_STATE, 'utf8')) as ServerState;
  return queryDatabase<T>(state.database, statement, parameters);
};

/**
 * Makes content reference a media asset, as package E's content saves do through
 * `services/mediaReferences.ts#addReferences`: a model, an entry, and its draft and published references.
 * The content admin (package F) does not exist yet, so the rows are written directly.
 */
export const seedMediaReference = async (assetId: string) => {
  const modelId = randomUUID();
  await queryServerDatabase(`insert into models (id, api_key, kind) values (?, ?, 'collection')`, [
    modelId,
    `mediaE2e${Date.now()}`,
  ]);
  // The entry belongs to the primary site, where the admin's media library lives (sites plan §H).
  const entry = await queryServerDatabase<{ id: string }>(
    `insert into entries (site_id, model_id)
     select id, ? from sites where is_primary returning id`,
    [modelId],
  );
  const entryId = entry[0]?.id;
  for (const state of ['draft', 'published']) {
    await queryServerDatabase(
      `insert into media_references (asset_id, entry_id, model_id, field_id, locale, state)
       values (?, ?, ?, 'f-hero', 'en', ?)`,
      [assetId, entryId, modelId, state],
    );
  }
  return { entryId, modelId };
};
