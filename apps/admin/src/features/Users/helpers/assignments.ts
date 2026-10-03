import type { RoleAssignment } from '@shapio/client';
import { z } from 'zod';

/**
 * Role assignments as the admin edits them (sites plan §H): one row per site, each a role on that site or on
 * every site. The server allows several roles per site; the admin keeps one, like the one-role rule.
 */

/** The select value for "All sites" (`siteId: null`). */
export const ALL_SITES = 'all';

export type AssignmentRow = { site: string; roleId: string };

export type AssignmentsValues = { rows: AssignmentRow[] };

const siteValue = (siteId: string | null) => siteId ?? ALL_SITES;

/**
 * The rows for a user's assignments: one per site, in the order the server gave them. Where a site holds
 * several roles, the owner role wins (it can only be held on every site), else the first.
 */
export const toAssignmentRows = (
  assignments: readonly RoleAssignment[],
  ownerRoleId: string | undefined,
): AssignmentRow[] => {
  const bySite = new Map<string, string>();
  for (const { roleId, siteId } of assignments) {
    const site = siteValue(siteId);
    if (!bySite.has(site) || roleId === ownerRoleId) {
      bySite.set(site, roleId);
    }
  }
  return [...bySite].map(([site, roleId]) => ({ site, roleId }));
};

export const toAssignments = (rows: readonly AssignmentRow[]): RoleAssignment[] =>
  rows.map(({ site, roleId }) => ({ roleId, siteId: site === ALL_SITES ? null : site }));

/**
 * At least one row, a role on each, a site at most once, and the owner role only on every site (the server
 * refuses it otherwise, 400 `OWNER_ALL_SITES`).
 */
export const assignmentRowsSchema = (ownerRoleId: string | undefined) =>
  z
    .array(z.object({ site: z.string().min(1), roleId: z.string().min(1, 'validation.selectRole') }))
    .min(1)
    .superRefine((rows, context) => {
      const seen = new Set<string>();
      rows.forEach((row, index) => {
        if (seen.has(row.site)) {
          context.addIssue({ code: 'custom', path: [index, 'site'], message: 'validation.siteTwice' });
        }
        seen.add(row.site);
        if (ownerRoleId !== undefined && row.roleId === ownerRoleId && row.site !== ALL_SITES) {
          context.addIssue({ code: 'custom', path: [index, 'roleId'], message: 'validation.ownerAllSites' });
        }
      });
    });

/** The next row "Add a site" adds: the first site no row names yet, with the given role. */
export const nextAssignmentRow = (
  rows: readonly AssignmentRow[],
  siteIds: readonly string[],
  roleId: string,
): AssignmentRow | undefined => {
  const used = new Set(rows.map((row) => row.site));
  const site = [ALL_SITES, ...siteIds].find((candidate) => !used.has(candidate));
  return site === undefined ? undefined : { site, roleId };
};
