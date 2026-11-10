import type { Policy } from './types.js';

/**
 * Whether a policy comes from a grant that names no fields (plan schema-lenses): the principal reads (or
 * writes) every field its audience may see on the model, not a chosen list. Decided by the grants' shape,
 * never by what the mask happens to cover today: a role granted one field keeps a one-field grant when every
 * other field is made private. Through a schema lens, only such a grant sees a field removed since the
 * client's version (as `null`). A mask of every field (admin principals) counts; a denied policy never does.
 */
export const hasUnrestrictedGrant = (policy: Policy, kind: 'read' | 'write'): boolean => {
  if (!policy.allowed) {
    return false;
  }
  const mask = kind === 'read' ? policy.readMask : policy.writeMask;
  return mask.mode === 'all' || policy.unrestrictedFields?.[kind] === true;
};
