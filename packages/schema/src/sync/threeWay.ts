import type { SchemaDefinition } from '../types/definitions.js';

/**
 * Per-definition three-way decision for `shapio schema apply` (ADR 0002). The base is what the lock file
 * recorded at pull time; local is the file in the repository; remote is the target instance now.
 *
 * - unchanged locally → skip, even if the target changed it since (no silent revert of production edits);
 * - changed locally and unchanged on the target → apply, guarded by the target's current version;
 * - changed on both → refuse and show the diff, like a rejected non-fast-forward push.
 *
 * Deletions need `prune`. Identical content on both sides is never a conflict.
 */
export type SyncSide = { version: number; hash: string };
export type SyncLocal = { definition: SchemaDefinition; hash: string };
export type SyncRemote = SyncSide & { definition: SchemaDefinition };

export type SyncInput = {
  local?: SyncLocal;
  base?: SyncSide;
  remote?: SyncRemote;
  prune: boolean;
};

export type SyncSkipReason =
  'unchangedLocally' | 'alreadyApplied' | 'remoteOnly' | 'deletedLocallyWithoutPrune' | 'alreadyDeleted';

export type SyncConflictReason =
  'changedOnBoth' | 'deletedOnTarget' | 'existsOnTarget' | 'changedOnTargetBeforeDelete';

export type SyncDecision =
  | { action: 'skip'; reason: SyncSkipReason }
  | { action: 'create' }
  | { action: 'update'; expectedVersion: number }
  | { action: 'delete'; expectedVersion: number }
  | { action: 'conflict'; reason: SyncConflictReason };

const unchangedSinceBase = (remote: SyncSide, base: SyncSide) =>
  remote.version === base.version || remote.hash === base.hash;

const decideForLocal = (
  local: SyncLocal,
  base: SyncSide | undefined,
  remote: SyncRemote | undefined,
): SyncDecision => {
  if (base && local.hash === base.hash) {
    return { action: 'skip', reason: 'unchangedLocally' };
  }
  if (!remote) {
    return base ? { action: 'conflict', reason: 'deletedOnTarget' } : { action: 'create' };
  }
  if (remote.hash === local.hash) {
    return { action: 'skip', reason: 'alreadyApplied' };
  }
  if (!base) {
    return { action: 'conflict', reason: 'existsOnTarget' };
  }
  return unchangedSinceBase(remote, base)
    ? { action: 'update', expectedVersion: remote.version }
    : { action: 'conflict', reason: 'changedOnBoth' };
};

export const decideSync = ({ local, base, remote, prune }: SyncInput): SyncDecision => {
  if (local) {
    return decideForLocal(local, base, remote);
  }
  if (!base) {
    return { action: 'skip', reason: 'remoteOnly' };
  }
  if (!remote) {
    return { action: 'skip', reason: 'alreadyDeleted' };
  }
  if (!prune) {
    return { action: 'skip', reason: 'deletedLocallyWithoutPrune' };
  }
  return unchangedSinceBase(remote, base)
    ? { action: 'delete', expectedVersion: remote.version }
    : { action: 'conflict', reason: 'changedOnTargetBeforeDelete' };
};
