import { SHAPIO_VERSION } from '../constants/version.js';
import { AppError } from '../helpers/appError.js';
import { hashToken } from '../helpers/tokens.js';
import { scopePermissions } from '../permissions/scoped.js';
import { principalForSite } from '../permissions/sites.js';
import type { Principal } from '../permissions/types.js';
import * as requestStateRepository from '../repositories/requestState.js';
import type { DeliveryStateRow, SiteLookup } from '../repositories/requestState.js';
import { isTokenExpired, resolveApiToken } from '../services/apiTokens.js';
import type { ContentServiceContext } from '../services/contentAccess.js';
import { buildContentContext } from '../services/contentContext.js';
import { resolveSite } from '../services/sites.js';
import { ShapioVersionSkewError } from './errors.js';
import type { DeliveryRuntime } from './runtime.js';

/** Who an in-process call reads as, and which site it reads. */
export type CallCredentials = {
  /** A delivery API token; none reads as an anonymous caller (the site's `public` role). */
  token?: string;
  /** The site key; default the token's site, else the primary site (as over HTTP). */
  site?: string;
};

const ANONYMOUS: Principal = Object.freeze({ kind: 'anonymous', siteId: null });

const invalidToken = () => new AppError(401, 'INVALID_TOKEN', 'The API token is invalid, expired or revoked');

/**
 * Runs a statement of the call's preamble, mapping a failure on a database that predates this release (a
 * statement names a column or table it lacks) to a version skew rather than an SQL error.
 */
const guardingSkew = async <T>(runtime: DeliveryRuntime, statement: () => Promise<T>): Promise<T> => {
  try {
    return await statement();
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    // Loaded only here: the migration list is not needed on the read path.
    const { getPendingMigrations } = await import('../db/migrator.js');
    if ((await getPendingMigrations(runtime.db)).length > 0) {
      throw new ShapioVersionSkewError(null, SHAPIO_VERSION, { cause: error });
    }
    throw error;
  }
};

/** The one state statement: versions, site, release, descriptor and the token's liveness. */
const readState = (
  runtime: DeliveryRuntime,
  site: SiteLookup,
  tokenId: string | undefined,
): Promise<DeliveryStateRow> =>
  guardingSkew(runtime, () =>
    requestStateRepository.readForDelivery(
      { site, ...(tokenId !== undefined ? { tokenId } : {}) },
      runtime.db,
    ),
  );

/**
 * The caller: anonymous, or a delivery token resolved once per runtime (read-only: in-process reads never
 * record a token's use) and checked for liveness on every call by the state read. Admin-scope tokens are
 * refused: in-process reads are delivery reads only (rule 7).
 */
const callerOf = async (
  runtime: DeliveryRuntime,
  token: string | undefined,
): Promise<{ principal: Principal; tokenKey?: string; tokenId?: string }> => {
  if (token === undefined) {
    return { principal: ANONYMOUS };
  }
  const tokenKey = hashToken(token);
  let principal = runtime.tokens.get(tokenKey);
  if (!principal) {
    const resolved = await guardingSkew(runtime, () =>
      resolveApiToken(token, new Date(), { recordUse: false, executor: runtime.db }),
    );
    if (!resolved) {
      throw invalidToken();
    }
    if (resolved.scope !== 'delivery') {
      throw new AppError(
        403,
        'DELIVERY_TOKEN_REQUIRED',
        'In-process reads take a delivery token (or none); this is an admin API token',
      );
    }
    runtime.tokens.set(tokenKey, resolved);
    principal = resolved;
  }
  return { principal, tokenKey, tokenId: principal.tokenId };
};

/**
 * Opens one in-process call the way the HTTP API opens a request: one statement reads the schema and
 * permissions versions, the site, the server's release and descriptor, and the token's liveness; the call
 * then sees the schema and the permissions at those versions (a change committed later applies from the next
 * call, so a model changed in the admin shows on the next call without a restart: rule 1).
 */
export const openCallScope = async (
  runtime: DeliveryRuntime,
  { token, site: requestedKey }: CallCredentials,
): Promise<ContentServiceContext> => {
  const caller = await callerOf(runtime, token);
  let state: DeliveryStateRow | undefined;
  const site = await resolveSite(
    {
      credentialSiteId:
        caller.principal.kind === 'token' ? (caller.principal.siteId ?? undefined) : undefined,
      requestedKey,
    },
    async (lookup) => {
      state = await readState(runtime, lookup, caller.tokenId);
      // Before anything else of the row is trusted: another release may mean other semantics.
      if (state.release !== SHAPIO_VERSION) {
        throw new ShapioVersionSkewError(state.release, SHAPIO_VERSION);
      }
      return state.site;
    },
  );
  if (!state) {
    throw new Error('The site was resolved without reading the request state');
  }
  if (caller.tokenKey !== undefined) {
    const live = state.token;
    if (!live || live.revokedAt !== null || isTokenExpired(live.expiresAt, new Date())) {
      runtime.tokens.delete(caller.tokenKey);
      throw invalidToken();
    }
  }
  if (state.descriptor === null) {
    throw new AppError(503, 'SERVER_NOT_STARTED', 'Start the Shapio server of this release once');
  }
  const versions = {
    schemaVersion: state.schemaVersion,
    permissionsVersion: state.permissionsVersion,
  };
  const principal = principalForSite(caller.principal, site.id);
  const [network, media] = await Promise.all([
    runtime.registry.getSnapshot(undefined, versions),
    runtime.mediaFor(state.descriptor),
  ]);
  return buildContentContext({
    db: runtime.db,
    network,
    permissions: scopePermissions(runtime.permissions, principal, versions),
    actor: principal,
    site,
    media,
  });
};
