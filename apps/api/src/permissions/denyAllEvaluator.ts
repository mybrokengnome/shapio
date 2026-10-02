import { DENIED_POLICY, type PermissionEvaluator } from './types.js';

/** Default until package B lands: every request is denied. Secure by default, never permissive. */
export const denyAllEvaluator: PermissionEvaluator = {
  evaluate: () => Promise.resolve(DENIED_POLICY),
  canPerform: () => Promise.resolve(false),
};
