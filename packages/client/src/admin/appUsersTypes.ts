/**
 * App users and app roles as administrators manage them (package I), mirroring the TypeBox route schemas in
 * apps/api/src/routes/admin/{appUsers,appRoles}. JSON is camelCase; timestamps are ISO-8601.
 */
import type { RoleCondition } from './types.js';

export type AdminAppUser = {
  id: string;
  email: string;
  name: string;
  confirmed: boolean;
  blocked: boolean;
  /** False for accounts that only sign in with an OAuth provider. */
  hasPassword: boolean;
  /** OAuth providers linked to the account (`google`, `github`). */
  providers: string[];
  /** Custom app roles; `authenticated` applies to every app user implicitly. */
  roleIds: string[];
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
};

/** Newest first, cursor-paginated; `search` matches email or name. */
export type AppUserQuery = { search?: string; cursor?: string; limit?: number };

export type AppUserPage = { items: AdminAppUser[]; nextCursor: string | null };

export type UpdateAppUserInput = { blocked?: boolean; roleIds?: string[] };

/** What app roles may grant: content actions only. */
export const APP_CONTENT_ACTIONS = ['read', 'create', 'update', 'delete', 'publish'] as const;
export type AppContentAction = (typeof APP_CONTENT_ACTIONS)[number];

/** Built-in app role keys: `public` applies to anonymous callers, `authenticated` to every app user. */
export const BUILT_IN_APP_ROLE_KEYS = ['public', 'authenticated'] as const;

export type AppRolePermission = {
  action: AppContentAction;
  /** `null` grants the action on every model, including ones created later. */
  modelId: string | null;
  condition: RoleCondition | null;
  /** `null` = every public field; otherwise exactly these stable field IDs (non-public ones included). */
  fieldIds: string[] | null;
};

export type AppRole = {
  id: string;
  key: string;
  name: string;
  description: string;
  isSystem: boolean;
  version: number;
  permissions: AppRolePermission[];
  userCount: number;
  createdAt: string;
  updatedAt: string;
};

export type CreateAppRoleInput = {
  key: string;
  name: string;
  description?: string;
  permissions: AppRolePermission[];
};

/** Built-in roles accept `permissions` only. */
export type UpdateAppRoleInput = {
  expectedVersion: number;
  name?: string;
  description?: string;
  permissions?: AppRolePermission[];
};
