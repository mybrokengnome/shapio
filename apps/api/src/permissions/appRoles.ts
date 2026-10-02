import type { ContentAction } from './types.js';

/**
 * Built-in app roles (package I). Their IDs are fixed (seeded by migration 20261001180000_create_app_users),
 * so the evaluator can apply them without a lookup: `public` to every anonymous caller, `authenticated` to
 * every signed-in app user on top of their custom roles.
 */
export const APP_ROLE_IDS = {
  public: '00000000-0000-4000-a000-000000000001',
  authenticated: '00000000-0000-4000-a000-000000000002',
} as const;

export const APP_ROLE_KEYS = { public: 'public', authenticated: 'authenticated' } as const;

/**
 * What app roles may grant: content actions only. Schema management and every instance-level action stay
 * with admin roles, whatever an app role row says.
 */
export const APP_CONTENT_ACTIONS = [
  'read',
  'create',
  'update',
  'delete',
  'publish',
] as const satisfies readonly ContentAction[];
export type AppContentAction = (typeof APP_CONTENT_ACTIONS)[number];
