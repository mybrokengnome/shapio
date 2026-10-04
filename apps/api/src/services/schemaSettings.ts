import * as schemaSettingsRepository from '../repositories/schemaSettings.js';
import { actorColumns } from '../schema/planner/actor.js';
import { recordAudit } from './audit.js';
import { assertCanChangeNetworkSchema, type SchemaServiceContext } from './schemaAccess.js';

const toSettings = (row: schemaSettingsRepository.SchemaSettingsRow) => ({
  readOnly: row.read_only,
  readOnlyReason: row.read_only_reason,
  updatedAt: row.updated_at.toISOString(),
});

export const getSchemaSettings = async (context: SchemaServiceContext) =>
  toSettings(await schemaSettingsRepository.get(context.db));

/**
 * The opt-in read-only lock (ADR 0002): when on, the admin UI and model routes refuse schema changes and
 * only `shapio schema apply` changes the schema. Off by default; turning it on or off is audited.
 */
export const updateSchemaSettings = async (
  context: SchemaServiceContext,
  input: { readOnly: boolean; readOnlyReason?: string | null },
) => {
  await assertCanChangeNetworkSchema(context);
  const by = actorColumns(context.actor);
  return context.db.transaction().execute(async (trx) => {
    await schemaSettingsRepository.update(
      {
        readOnly: input.readOnly,
        reason: input.readOnlyReason ?? null,
        byType: by.type,
        byId: by.id,
        now: new Date(),
      },
      trx,
    );
    await recordAudit(trx, {
      actor: context.actor,
      action: 'schema.settings.update',
      target: { type: 'schemaSettings', id: 'schema' },
      metadata: { readOnly: input.readOnly },
      ...(context.requestId ? { requestId: context.requestId } : {}),
      ...(context.ip ? { ip: context.ip } : {}),
    });
    return toSettings(await schemaSettingsRepository.get(trx));
  });
};
