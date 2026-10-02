import type { RequestFn } from '../request.js';
import type {
  AdminAppUser,
  AppRole,
  AppUserPage,
  AppUserQuery,
  CreateAppRoleInput,
  UpdateAppRoleInput,
  UpdateAppUserInput,
} from './appUsersTypes.js';
import { ADMIN_PATHS, withId } from './paths.js';
import { toQueryString } from './query.js';

/** App users (Users → App users) and app roles (Settings → Roles → App roles). */
export const createAppUsersApi = (request: RequestFn) => ({
  appUsers: {
    list: (query: AppUserQuery = {}) =>
      request<AppUserPage>(`${ADMIN_PATHS.appUsers}${toQueryString(query)}`),
    get: (id: string) => request<AdminAppUser>(withId(ADMIN_PATHS.appUsers, id)),
    /** Block/unblock and replace custom roles. Blocking takes effect on the user's next request. */
    update: (id: string, body: UpdateAppUserInput) =>
      request<AdminAppUser>(withId(ADMIN_PATHS.appUsers, id), { method: 'PATCH', body }),
    remove: (id: string) => request<void>(withId(ADMIN_PATHS.appUsers, id), { method: 'DELETE' }),
    /** 409 NOT_CONFIGURED without APP_AUTH_CONFIRM_EMAIL_URL; 409 ALREADY_CONFIRMED. */
    resendConfirmation: (id: string) =>
      request<void>(`${withId(ADMIN_PATHS.appUsers, id)}/resend-confirmation`, { method: 'POST' }),
  },
  appRoles: {
    list: () => request<AppRole[]>(ADMIN_PATHS.appRoles),
    get: (id: string) => request<AppRole>(withId(ADMIN_PATHS.appRoles, id)),
    create: (body: CreateAppRoleInput) => request<AppRole>(ADMIN_PATHS.appRoles, { method: 'POST', body }),
    /** 409 VERSION_CONFLICT when `expectedVersion` is stale. */
    update: (id: string, body: UpdateAppRoleInput) =>
      request<AppRole>(withId(ADMIN_PATHS.appRoles, id), { method: 'PATCH', body }),
    remove: (id: string) => request<void>(withId(ADMIN_PATHS.appRoles, id), { method: 'DELETE' }),
  },
});
