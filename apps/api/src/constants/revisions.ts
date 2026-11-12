/**
 * Why a content revision was written: the values `content_revisions.reason` allows (its check constraint, last
 * set by migration 20261002180200 and the SQLite and MySQL baselines; `revisions.test.ts` keeps them equal).
 * Services, the repository and the transfer bundle format all take them from here.
 */
export const REVISION_REASONS = [
  'create',
  'save',
  'publish',
  'restore',
  'duplicate',
  'localize',
  'conversion',
] as const;

export type RevisionReason = (typeof REVISION_REASONS)[number];
