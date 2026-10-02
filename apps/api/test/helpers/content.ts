import { randomUUID } from 'node:crypto';
import type { LightMyRequestResponse } from 'fastify';
import { API_TOKEN_DISPLAY_LENGTH, API_TOKEN_PREFIX } from '../../src/constants/auth.js';
import { createContentPorts } from '../../src/content/ports.js';
import type { Database } from '../../src/db/index.js';
import { generateToken, hashToken } from '../../src/helpers/tokens.js';
import type { ContentAction } from '../../src/permissions/types.js';
import * as adminRolesRepository from '../../src/repositories/adminRoles.js';
import * as apiTokensRepository from '../../src/repositories/apiTokens.js';
import * as permissionsVersionRepository from '../../src/repositories/permissionsVersion.js';
import { runSchemaJobs, type SchemaClient } from './schemaAdmin.js';

export type FieldBody = { id: string; apiKey: string } & Record<string, unknown>;
export type ModelBody = {
  definition: { id: string; apiKey: string; fields: FieldBody[] } & Record<string, unknown>;
  version: number;
};

/** Creates a model or component through the admin API and returns it as stored (with field IDs). */
export const createDefinition = async (
  admin: SchemaClient,
  definition: Record<string, unknown>,
  kind: 'models' | 'components' = 'models',
): Promise<ModelBody> => {
  const created = await admin.post(`/api/admin/${kind}`, { definition });
  if (created.statusCode !== 201) {
    throw new Error(`Creating ${String(definition.apiKey)} failed: ${created.statusCode} ${created.body}`);
  }
  const { definitionId } = created.json<{ definitionId: string }>();
  return (await admin.get(`/api/admin/${kind}/${definitionId}`)).json<ModelBody>();
};

export const fieldIdOf = (model: ModelBody, apiKey: string): string => {
  const field = model.definition.fields.find((candidate) => candidate.apiKey === apiKey);
  if (!field) {
    throw new Error(`No field ${apiKey}`);
  }
  return field.id;
};

export type GrantSpec = {
  action: ContentAction;
  modelId: string | null;
  fieldIds?: string[] | null;
  condition?: 'ownedByPrincipal' | null;
};

/** A custom role with exactly these grants, inserted directly; returns its ID (`key` is `test-<id>`). */
export const createRole = async (db: Database, kind: 'admin' | 'delivery', grants: readonly GrantSpec[]) =>
  db.transaction().execute(async (trx) => {
    const key = `test-${randomUUID()}`;
    const role = await adminRolesRepository.insert(
      { key, name: `Test ${kind} role ${key}`, description: '', kind, is_system: false },
      trx,
    );
    await adminRolesRepository.insertPermissions(
      grants.map((grant) => ({
        role_id: role.id,
        action: grant.action,
        model_id: grant.modelId,
        condition: grant.condition ?? null,
        field_ids: grant.fieldIds ?? null,
      })),
      trx,
    );
    await permissionsVersionRepository.bumpPermissionsVersion(trx);
    return role.id;
  });

export const roleKeyOf = async (db: Database, roleId: string): Promise<string> =>
  (await adminRolesRepository.findById(roleId, db))?.key ?? '';

/** An API token bound to a role ID. */
export const createTokenForRole = async (db: Database, roleId: string): Promise<string> => {
  const token = `${API_TOKEN_PREFIX}${generateToken()}`;
  await apiTokensRepository.insert(
    {
      name: `test token ${randomUUID()}`,
      token_hash: hashToken(token),
      token_prefix: token.slice(0, API_TOKEN_DISPLAY_LENGTH),
      role_id: roleId,
    },
    db,
  );
  return token;
};

/** A delivery token that may read the given models (every public field unless `fieldIds` is given). */
export const createDeliveryToken = async (db: Database, grants: readonly Omit<GrantSpec, 'action'>[]) =>
  createTokenForRole(
    db,
    await createRole(
      db,
      'delivery',
      grants.map((grant) => ({ ...grant, action: 'read' as const })),
    ),
  );

/** Runs schema jobs with the real content ports. */
export const runContentSchemaJobs = (db: Database) => runSchemaJobs(db, createContentPorts(db));

export type EntryBody = {
  id: string;
  locale: string;
  version: number;
  revisionId: string;
  status: string;
  data: Record<string, unknown>;
  locales: Array<{ locale: string; status: string; sharedOutdated: boolean; version: number }>;
  sharedOutdatedLocales: string[];
};

export const expectStatus = (response: LightMyRequestResponse, status: number) => {
  if (response.statusCode !== status) {
    throw new Error(`Expected ${status}, got ${response.statusCode}: ${response.body}`);
  }
  return response;
};
