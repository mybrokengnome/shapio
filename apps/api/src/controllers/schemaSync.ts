import type { LockFile } from '@shapio/schema';
import type { FastifyRequest } from 'fastify';
import * as schemaDefinitionsService from '../services/schemaDefinitions.js';
import type { DefinitionScope } from '../services/schemaDefinitions.js';
import * as schemaSettingsService from '../services/schemaSettings.js';
import * as schemaSyncService from '../services/schemaSync.js';
import { schemaContextFor, toChangeJobResponse } from './schemaContext.js';

type ApplyRequest = FastifyRequest<{
  Body: {
    definitions: unknown[];
    scopes?: DefinitionScope[];
    base: LockFile;
    prune?: boolean;
    dryRun?: boolean;
    acknowledgeBreaking?: boolean;
    acknowledgeDestructive?: boolean;
  };
}>;
type ExportRequest = FastifyRequest<{ Querystring: { scope?: DefinitionScope } }>;
type ChangeRequest = FastifyRequest<{ Params: { changeId: string } }>;
type SettingsRequest = FastifyRequest<{ Body: { readOnly: boolean; readOnlyReason?: string | null } }>;

export const getSchemaSummary = async (request: FastifyRequest) => {
  const context = await schemaContextFor(request);
  const { schemaVersion, definitions } = await schemaSyncService.exportSchema(context);
  return {
    schemaVersion,
    defaultLocale: context.snapshot.defaultLocale,
    definitions: definitions.map(({ definition, version, hash, site }) => ({
      id: definition.id,
      kind: definition.kind,
      apiKey: definition.apiKey,
      label: definition.label,
      version,
      hash,
      site,
    })),
  };
};

export const exportSchema = async (request: ExportRequest) =>
  schemaSyncService.exportSchema(await schemaContextFor(request), request.query.scope);

export const applySchema = async (request: ApplyRequest) => {
  const { definitions, scopes, base, prune = false, dryRun = false, ...ack } = request.body;
  return schemaSyncService.applySchema(await schemaContextFor(request), {
    definitions,
    scopes,
    base,
    prune,
    dryRun,
    ...ack,
  });
};

export const getChange = async (request: ChangeRequest) =>
  toChangeJobResponse(
    await schemaDefinitionsService.getChange(await schemaContextFor(request), request.params.changeId),
  );

export const getSettings = async (request: FastifyRequest) =>
  schemaSettingsService.getSchemaSettings(await schemaContextFor(request));

export const updateSettings = async (request: SettingsRequest) =>
  schemaSettingsService.updateSchemaSettings(await schemaContextFor(request), request.body);
