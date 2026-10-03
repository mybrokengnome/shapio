import { db } from '../db/index.js';
import type { Database } from '../db/index.js';
import { isUniqueViolation } from '../db/sql/errors.js';
import { AppError } from '../helpers/appError.js';
import { assignedSiteIdsOf } from '../permissions/sites.js';
import type { AdminPrincipal, TokenPrincipal } from '../permissions/types.js';
import * as appUsersRepository from '../repositories/appUsers.js';
import * as contentPurgeRepository from '../repositories/contentPurge.js';
import * as mediaAssetsRepository from '../repositories/mediaAssets.js';
import * as sitesRepository from '../repositories/sites.js';
import type { SiteRow } from '../repositories/sites.js';
import type { ActorContext, SiteRef } from './actorContext.js';
import { recordAudit } from './audit.js';

/**
 * Sites (plan agentic-ecosystem §H, ADR 0011): the tenants of content. The schema, locales, admin users and
 * roles are shared; everything a site publishes is its own. Exactly one site is primary: requests that name
 * no site go to it, and it can never be deleted.
 */
export type SiteView = {
  id: string;
  key: string;
  name: string;
  isPrimary: boolean;
  version: number;
  createdAt: Date;
  updatedAt: Date;
};

export type SiteSummaryView = Pick<SiteView, 'id' | 'key' | 'name' | 'isPrimary'>;

export const toSiteView = (row: SiteRow): SiteView => ({
  id: row.id,
  key: row.key,
  name: row.name,
  isPrimary: row.is_primary,
  version: row.version,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const toSiteSummary = (row: SiteRow): SiteSummaryView => ({
  id: row.id,
  key: row.key,
  name: row.name,
  isPrimary: row.is_primary,
});

export const toSiteRef = (row: Pick<SiteRow, 'id' | 'key'>): SiteRef => ({ id: row.id, key: row.key });

const siteNotFound = () => new AppError(404, 'SITE_NOT_FOUND', 'Site not found');

/** A site's summary by ID (`me` for a site the admin holds no role on: they see its name, nothing else). */
export const getSiteSummary = async (siteId: string): Promise<SiteSummaryView> => {
  const site = await sitesRepository.findById(siteId);
  if (!site) {
    throw siteNotFound();
  }
  return toSiteSummary(site);
};

/** The reference of a site by ID (jobs and deferred work carry the ID of the site they belong to). */
export const getSiteRef = async (siteId: string, executor: Database = db): Promise<SiteRef> => {
  const site = await sitesRepository.findById(siteId, executor);
  if (!site) {
    throw siteNotFound();
  }
  return toSiteRef(site);
};

/**
 * The sites a principal works on: every site for a role assigned on every site (or a network token),
 * otherwise the sites it holds a role on. Used by `me` and the site switcher.
 */
export const listAccessibleSites = async (principal: AdminPrincipal | TokenPrincipal): Promise<SiteRow[]> => {
  if (principal.kind === 'token') {
    return principal.siteId === null ? sitesRepository.list() : sitesRepository.findByIds([principal.siteId]);
  }
  return principal.networkRoleIds.length > 0
    ? sitesRepository.list()
    : sitesRepository.findByIds(assignedSiteIdsOf(principal.assignments));
};

export const listSites = async (principal: AdminPrincipal | TokenPrincipal): Promise<SiteView[]> =>
  (await listAccessibleSites(principal)).map(toSiteView);

export const getSite = async (principal: AdminPrincipal | TokenPrincipal, id: string): Promise<SiteView> => {
  const site = (await listAccessibleSites(principal)).find((row) => row.id === id);
  if (!site) {
    throw siteNotFound();
  }
  return toSiteView(site);
};

/** Every site, primary first (`shapio sites list`, which runs on the server host without a principal). */
export const listAllSites = async (database: Database = db): Promise<SiteView[]> =>
  (await sitesRepository.list(database)).map(toSiteView);

/** A new site starts empty: its own publication sequence at 0, and no app roles bound (deny by default). */
export const createSite = async (
  context: ActorContext,
  input: { key: string; name: string },
  database: Database = db,
): Promise<SiteView> => {
  try {
    return await database.transaction().execute(async (trx) => {
      const site = await sitesRepository.insert({ key: input.key, name: input.name.trim() }, trx);
      await sitesRepository.insertPublicationState(site.id, trx);
      await recordAudit(trx, {
        ...context,
        action: 'site.create',
        target: { type: 'site', id: site.id },
        metadata: { key: site.key, name: site.name },
      });
      return toSiteView(site);
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError(409, 'SITE_KEY_TAKEN', 'A site with this key already exists', undefined, {
        cause: error,
      });
    }
    throw error;
  }
};

/** Optimistic: fails with VERSION_CONFLICT when the site changed since `expectedVersion` was read. */
export const renameSite = async (
  context: ActorContext,
  id: string,
  input: { expectedVersion: number; name: string },
): Promise<SiteView> =>
  db.transaction().execute(async (trx) => {
    const current = await sitesRepository.findById(id, trx);
    if (!current) {
      throw siteNotFound();
    }
    const updated = await sitesRepository.renameIfVersion(id, input.expectedVersion, input.name.trim(), trx);
    if (!updated) {
      throw new AppError(409, 'VERSION_CONFLICT', 'The site changed since you loaded it', {
        expectedVersion: input.expectedVersion,
        actualVersion: current.version,
      });
    }
    await recordAudit(trx, {
      ...context,
      action: 'site.update',
      target: { type: 'site', id },
      metadata: { name: { from: current.name, to: updated.name } },
    });
    return toSiteView(updated);
  });

/**
 * Deletes an empty site: no live entries, media or app users, no folders or change sets. Its soft-deleted
 * entries (with their history), media assets and app users are purged first; its tokens, webhooks, deployment
 * connections, role assignments, app role bindings, snapshot ledger and usage counters go with it.
 */
export const deleteSite = async (context: ActorContext, id: string): Promise<void> => {
  await db.transaction().execute(async (trx) => {
    const site = await sitesRepository.lockById(id, trx);
    if (!site) {
      throw siteNotFound();
    }
    if (site.is_primary) {
      throw new AppError(409, 'SITE_IS_PRIMARY', 'The primary site cannot be deleted');
    }
    const contents = await sitesRepository.countContents(id, trx);
    if (Object.values(contents).some((count) => count > 0)) {
      throw new AppError(
        409,
        'SITE_NOT_EMPTY',
        'Only an empty site can be deleted: remove its entries, media, change sets and app users first',
        contents,
      );
    }
    await contentPurgeRepository.purgeDeletedEntriesOfSite(id, trx);
    await mediaAssetsRepository.deleteSoftDeletedOfSite(id, trx);
    await appUsersRepository.deleteSoftDeletedOfSite(id, trx);
    await sitesRepository.deleteById(id, trx);
    await recordAudit(trx, {
      ...context,
      action: 'site.delete',
      target: { type: 'site', id },
      metadata: { key: site.key, name: site.name },
    });
  });
};

export type SiteResolutionInput = {
  /** The site the credential belongs to (a site token); undefined when the credential names none. */
  credentialSiteId: string | undefined;
  /** The site key the request names (`Shapio-Site` header or `?site=`). */
  requestedKey: string | undefined;
};

/**
 * Which site a request is about (sites plan §H): the credential's site, else the site the request names,
 * else the primary site. A request that names a different site than its credential is refused
 * (403 `SITE_MISMATCH`), never redirected; an unknown key is 404 `SITE_NOT_FOUND`.
 */
export const resolveSite = async ({
  credentialSiteId,
  requestedKey,
}: SiteResolutionInput): Promise<SiteRef> => {
  if (credentialSiteId !== undefined) {
    const site = await sitesRepository.findById(credentialSiteId);
    if (!site) {
      throw siteNotFound();
    }
    if (requestedKey !== undefined && requestedKey !== site.key) {
      throw new AppError(
        403,
        'SITE_MISMATCH',
        `This credential belongs to site "${site.key}", not "${requestedKey}"`,
      );
    }
    return toSiteRef(site);
  }
  if (requestedKey !== undefined) {
    const site = await sitesRepository.findByKey(requestedKey);
    if (!site) {
      throw new AppError(404, 'SITE_NOT_FOUND', `No site has the key "${requestedKey}"`);
    }
    return toSiteRef(site);
  }
  return toSiteRef(await sitesRepository.findPrimary());
};
