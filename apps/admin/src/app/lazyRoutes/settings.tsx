import { createLazyRoute } from '@tanstack/react-router';
import { Settings } from '@/features/Settings';
import { ApiTokens } from '@/features/Settings/ApiTokens';
import { Appearance } from '@/features/Settings/Appearance';
import { AuditLog } from '@/features/Settings/AuditLog';
import { Locales } from '@/features/Settings/Locales';
import { Profile } from '@/features/Settings/Profile';
import { Roles } from '@/features/Settings/Roles';
import { AppRoles } from '@/features/Settings/Roles/AppRoles';
import { Editor as AppRoleEditor } from '@/features/Settings/Roles/AppRoles/Editor';
import { Sessions } from '@/features/Settings/Sessions';

/** Every settings screen, loaded together on the first visit to Settings. */
export const settingsLazyRoutes = {
  settings: createLazyRoute('/app/settings')({ component: Settings }),
  profile: createLazyRoute('/app/settings/profile')({ component: Profile }),
  sessions: createLazyRoute('/app/settings/sessions')({ component: Sessions }),
  theme: createLazyRoute('/app/settings/theme')({ component: Appearance }),
  locales: createLazyRoute('/app/settings/locales')({ component: Locales }),
  roles: createLazyRoute('/app/settings/roles')({ component: Roles }),
  appRoles: createLazyRoute('/app/settings/roles/app')({ component: AppRoles }),
  appRole: createLazyRoute('/app/settings/roles/app/$roleId')({ component: AppRoleEditor }),
  apiTokens: createLazyRoute('/app/settings/api-tokens')({ component: ApiTokens }),
  auditLog: createLazyRoute('/app/settings/audit-log')({ component: AuditLog }),
};
