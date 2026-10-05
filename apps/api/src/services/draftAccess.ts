import { AppError } from '../helpers/appError.js';
import { READ_DRAFTS_ACTION, type Principal } from '../permissions/types.js';
import type { ContentServiceContext } from './contentAccess.js';

/**
 * Who may read draft heads through the delivery API (plan drafts-mode §1). Admin users, admin-scope tokens
 * and Shapio itself always could (GraphQL previews). A delivery token may when its role grants `readDrafts`,
 * which always covers every model, so this one check per request also covers relation targets. App users and
 * anonymous callers never may, whatever a role says (the evaluator denies them too). The caller has already
 * checked `read` on the model.
 */
const isAdminPrincipal = (principal: Principal): boolean =>
  principal.kind === 'system' ||
  principal.kind === 'admin' ||
  (principal.kind === 'token' && principal.scope === 'admin');

const draftsForbidden = (message: string) => new AppError(403, 'DRAFTS_FORBIDDEN', message);

export const assertMayReadDrafts = async (
  context: ContentServiceContext,
  modelId: string,
  modelKey: string,
): Promise<void> => {
  const { actor } = context;
  if (isAdminPrincipal(actor)) {
    return;
  }
  if (actor.kind !== 'token') {
    throw draftsForbidden('Drafts need an admin user or a delivery token granted Read drafts');
  }
  const policy = await context.permissions.evaluate(actor, { action: READ_DRAFTS_ACTION, modelId });
  if (!policy.allowed) {
    throw draftsForbidden(
      `This token may not read drafts of "${modelKey}"; grant Read drafts on its delivery role`,
    );
  }
};
