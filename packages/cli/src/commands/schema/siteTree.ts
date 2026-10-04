import type { DefinitionScope } from '@shapio/client';
import {
  lockEntriesForSite,
  upgradeLockFile,
  withSiteCovered,
  type LockFile,
  type ScopedLockFile,
} from '@shapio/schema';
import type { LocalFile } from './files.js';

/**
 * Which part of a schema tree one site's sync is about (plan site-schema): the shared folders and that site's
 * own folder. One tree may hold several sites (`sites/<key>/`); a pull or apply for one never reads, sends,
 * rewrites or removes another site's files or lock entries.
 */

const inView = (site: string | null, siteKey: string) => site === null || site === siteKey;

/** The files an apply for `siteKey` sends: the shared ones and that site's. */
export const filesForSite = (files: readonly LocalFile[], siteKey: string): LocalFile[] =>
  files.filter((file) => inView(file.site, siteKey));

/** Each sent file's scope, parallel to the files: its folder decides (only creates use it). */
export const scopesOf = (files: readonly LocalFile[]): DefinitionScope[] =>
  files.map((file) => (file.site === null ? 'network' : 'site'));

/**
 * The base an apply for `siteKey` sends: the lock in format 2 with only the shared entries and that site's,
 * so neither the three-way decision nor `--prune` can ever see another site's IDs. `sites` is kept: the
 * server refuses a tree that covers other sites only.
 */
export const baseForSite = (lock: LockFile, siteKey: string): ScopedLockFile => {
  const upgraded = upgradeLockFile(lock);
  return {
    ...upgraded,
    definitions: lockEntriesForSite(upgraded, siteKey) as ScopedLockFile['definitions'],
  };
};

/** Files in the site's view that differ from what was last pulled (or were never pulled). */
export const editedFilesForSite = (
  files: readonly LocalFile[],
  lock: LockFile,
  siteKey: string,
): LocalFile[] => {
  const base = lockEntriesForSite(lock, siteKey);
  if (Object.keys(base).length === 0) {
    // Nothing of this view was pulled yet: a first pull adopts the instance's schema.
    return [];
  }
  return filesForSite(files, siteKey).filter((file) => {
    const entry = file.id ? base[file.id] : undefined;
    return !entry || file.hash !== entry.hash;
  });
};

/**
 * Files a pull of `siteKey` leaves stale: in the pulled scopes and not written (deleted or renamed on the
 * instance), plus any other file of a definition that was just written elsewhere (its scope changed on the
 * instance: it is the same definition, and two files with one ID would make the next apply fail).
 */
export const staleFilesAfterPull = (
  files: readonly LocalFile[],
  siteKey: string,
  written: ReadonlyMap<string, string>,
): LocalFile[] => {
  const writtenPaths = new Set(written.values());
  return files.filter((file) => {
    if (writtenPaths.has(file.path)) {
      return false;
    }
    return inView(file.site, siteKey) || (file.id !== undefined && written.has(file.id));
  });
};

/**
 * The lock after an apply for `siteKey` recorded its entries: the tree covers the site once it holds one of
 * the site's own definitions. A shared-only tree stays uncovered, so it still applies to every site.
 */
export const coverSiteIfHeld = (lock: ScopedLockFile, siteKey: string): ScopedLockFile =>
  Object.values(lock.definitions).some((entry) => entry.site === siteKey)
    ? { ...lock, sites: withSiteCovered(lock.sites, siteKey) }
    : lock;
