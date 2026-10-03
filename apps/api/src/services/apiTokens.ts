import {
  API_TOKEN_DISPLAY_LENGTH,
  API_TOKEN_PREFIX,
  LAST_SEEN_WRITE_INTERVAL_MS,
} from '../constants/auth.js';
import { db } from '../db/index.js';
import { AppError } from '../helpers/appError.js';
import { generateToken, hashToken } from '../helpers/tokens.js';
import { SYSTEM_ROLE_KEYS } from '../permissions/seedRoles.js';
import type { PermissionEvaluator, TokenPrincipal } from '../permissions/types.js';
import * as adminRolesRepository from '../repositories/adminRoles.js';
import * as apiTokensRepository from '../repositories/apiTokens.js';
import type { SiteActorContext } from './actorContext.js';
import { recordAudit } from './audit.js';

export type ApiTokenView = {
  id: string;
  name: string;
  /** The first characters of the token, for telling tokens apart. */
  tokenPrefix: string;
  roleId: string;
  scope: 'admin' | 'delivery';
  /** The token's site; null for a network admin token (its role applies on every site). */
  siteId: string | null;
  createdBy: string | null;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
};

type ApiTokenListRow = Awaited<ReturnType<typeof apiTokensRepository.listForSite>>[number];

const scopeOf = (roleKind: string): 'admin' | 'delivery' => (roleKind === 'delivery' ? 'delivery' : 'admin');

const toApiTokenView = (row: ApiTokenListRow): ApiTokenView => ({
  id: row.id,
  name: row.name,
  tokenPrefix: row.token_prefix,
  roleId: row.role_id,
  scope: scopeOf(row.role_kind),
  siteId: row.site_id,
  createdBy: row.created_by,
  expiresAt: row.expires_at,
  lastUsedAt: row.last_used_at,
  revokedAt: row.revoked_at,
  createdAt: row.created_at,
});

export const isApiTokenFormat = (value: string): boolean => value.startsWith(API_TOKEN_PREFIX);

/**
 * Network tokens (no site) are visible and revocable only by admins who could mint them (`users.manage`, a
 * network action); everyone else sees their site's tokens only.
 */
const managesNetworkTokens = (context: SiteActorContext, permissions: PermissionEvaluator) =>
  permissions.canPerform(context.actor, 'users.manage');

/** The request site's tokens, plus network tokens for those who manage them. */
export const listApiTokens = async (
  context: SiteActorContext,
  permissions: PermissionEvaluator,
): Promise<ApiTokenView[]> =>
  (
    await apiTokensRepository.listForSite(context.site.id, await managesNetworkTokens(context, permissions))
  ).map(toApiTokenView);

type CreateApiTokenInput = {
  name: string;
  roleId: string;
  expiresAt: Date | null;
  /** A network admin token (every site and network actions); omitted: network when the creator may grant it. */
  network?: boolean | undefined;
};

/**
 * Whether the new token is a network token (sites plan §H). A network admin token carries its role on every
 * site and into network actions, so only someone who may assign roles on every site (`users.manage`, a
 * network action) may mint one; anyone else's tokens belong to the request's site. Delivery tokens always
 * belong to a site.
 */
const isNetworkToken = async (
  context: SiteActorContext,
  permissions: PermissionEvaluator,
  roleKind: string,
  requested: boolean | undefined,
): Promise<boolean> => {
  if (roleKind === 'delivery') {
    if (requested === true) {
      throw new AppError(400, 'INVALID_TOKEN_SITE', 'Delivery tokens always belong to one site');
    }
    return false;
  }
  const mayGrantNetwork = await managesNetworkTokens(context, permissions);
  if (requested === true && !mayGrantNetwork) {
    throw new AppError(
      403,
      'FORBIDDEN',
      'Only admins who manage users on every site can create network tokens',
    );
  }
  return requested ?? mayGrantNetwork;
};

/**
 * Creates a token bound to one role. The value is returned once and stored only as a hash. The owner
 * role cannot be bound to a token: owner powers stay with people.
 */
export const createApiToken = async (
  context: SiteActorContext,
  permissions: PermissionEvaluator,
  input: CreateApiTokenInput,
): Promise<{ token: string; apiToken: ApiTokenView }> => {
  const now = new Date();
  if (input.expiresAt !== null && input.expiresAt.getTime() <= now.getTime()) {
    throw new AppError(400, 'INVALID_EXPIRY', 'The expiry must be in the future');
  }
  const token = `${API_TOKEN_PREFIX}${generateToken()}`;
  return db.transaction().execute(async (trx) => {
    const role = await adminRolesRepository.findById(input.roleId, trx);
    if (!role) {
      throw new AppError(400, 'INVALID_ROLES', 'The role does not exist');
    }
    if (role.key === SYSTEM_ROLE_KEYS.owner) {
      throw new AppError(400, 'INVALID_ROLES', 'API tokens cannot hold the owner role');
    }
    const network = await isNetworkToken(context, permissions, role.kind, input.network);
    const { id } = await apiTokensRepository.insert(
      {
        name: input.name.trim(),
        token_hash: hashToken(token),
        token_prefix: token.slice(0, API_TOKEN_DISPLAY_LENGTH),
        role_id: role.id,
        site_id: network ? null : context.site.id,
        created_by: context.actor.kind === 'admin' ? context.actor.adminUserId : null,
        expires_at: input.expiresAt,
      },
      trx,
    );
    await recordAudit(trx, {
      ...context,
      action: 'api_token.create',
      target: { type: 'api_token', id },
      metadata: {
        name: input.name,
        roleId: role.id,
        siteId: network ? null : context.site.id,
        expiresAt: input.expiresAt?.toISOString() ?? null,
      },
    });
    const row = await apiTokensRepository.findById(id, trx);
    if (!row) {
      throw new Error('API token vanished after insert');
    }
    return { token, apiToken: toApiTokenView(row) };
  });
};

/** Revokes a token of the request's site (or a network token, for those who manage them). */
export const revokeApiToken = async (
  context: SiteActorContext,
  permissions: PermissionEvaluator,
  id: string,
): Promise<void> => {
  const scope = { siteId: context.site.id, includeNetwork: await managesNetworkTokens(context, permissions) };
  await db.transaction().execute(async (trx) => {
    if (!(await apiTokensRepository.revoke(id, scope, new Date(), trx))) {
      throw new AppError(404, 'NOT_FOUND', 'Active API token not found');
    }
    await recordAudit(trx, { ...context, action: 'api_token.revoke', target: { type: 'api_token', id } });
  });
};

/** The principal for a bearer API token, or undefined when unknown, revoked or expired. */
export const resolveApiToken = async (
  value: string,
  now = new Date(),
): Promise<TokenPrincipal | undefined> => {
  const row = await apiTokensRepository.findLiveByHash(hashToken(value));
  if (!row || (row.expires_at !== null && row.expires_at.getTime() <= now.getTime())) {
    return undefined;
  }
  await apiTokensRepository.touchLastUsed(row.id, now, new Date(now.getTime() - LAST_SEEN_WRITE_INTERVAL_MS));
  return {
    kind: 'token',
    tokenId: row.id,
    scope: scopeOf(row.role_kind),
    roleId: row.role_id,
    siteId: row.site_id,
  };
};
