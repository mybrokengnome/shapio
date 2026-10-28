import type { Database } from '../db/index.js';
import { AppError } from '../helpers/appError.js';
import * as sitesRepository from '../repositories/sites.js';
import type { SiteActorContext } from './actorContext.js';
import { recordAudit } from './audit.js';

/**
 * A site's change set settings (plan approval): whether its change sets must be approved before they ship
 * or are scheduled. Any admin of the site reads it (the change set screen explains a disabled Ship); changing
 * it needs `site.settings` (the route checks it).
 */
export type SiteChangeSetsContext = SiteActorContext & { db: Database };

export type SiteChangeSetsView = { version: number; requireApproval: boolean };

const siteNotFound = () => new AppError(404, 'SITE_NOT_FOUND', 'Site not found');

export const getSiteChangeSets = async (context: SiteChangeSetsContext): Promise<SiteChangeSetsView> => {
  const row = await sitesRepository.findApprovalSetting(context.site.id, context.db);
  if (!row) {
    throw siteNotFound();
  }
  return { version: row.version, requireApproval: row.require_approval };
};

/** Optimistic: fails with VERSION_CONFLICT when the site changed since `expectedVersion` was read. */
export const updateSiteChangeSets = async (
  context: SiteChangeSetsContext,
  input: { expectedVersion: number; requireApproval: boolean },
): Promise<SiteChangeSetsView> =>
  context.db.transaction().execute(async (trx) => {
    const current = await sitesRepository.findApprovalSetting(context.site.id, trx);
    if (!current) {
      throw siteNotFound();
    }
    const updated = await sitesRepository.updateRequireApprovalIfVersion(
      context.site.id,
      input.expectedVersion,
      input.requireApproval,
      trx,
    );
    if (!updated) {
      throw new AppError(409, 'VERSION_CONFLICT', 'The site changed since you loaded it', {
        expectedVersion: input.expectedVersion,
        actualVersion: current.version,
      });
    }
    await recordAudit(trx, {
      ...context,
      action: 'site.change_sets_update',
      target: { type: 'site', id: context.site.id },
      metadata: { requireApproval: updated.require_approval },
    });
    return { version: updated.version, requireApproval: updated.require_approval };
  });
