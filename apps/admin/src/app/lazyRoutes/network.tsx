import { createLazyRoute } from '@tanstack/react-router';
import { ContentTypes } from '@/features/Network/ContentTypes';
import { New as NewContentType } from '@/features/Network/ContentTypes/New';
import { Site } from '@/features/Network/Site';
import { Sites } from '@/features/Network/Sites';
import { AuditLog } from '@/features/Settings/AuditLog';
import { Roles } from '@/features/Settings/Roles';
import { AppRoles } from '@/features/Settings/Roles/AppRoles';
import { Editor as AppRoleEditor } from '@/features/Settings/Roles/AppRoles/Editor';
import { Users } from '@/features/Users';

/** The network view's screens (sites plan §H), loaded together on the first visit. */
export const networkLazyRoutes = {
  sites: createLazyRoute('/app/network/sites')({ component: Sites }),
  site: createLazyRoute('/app/network/sites/$siteId')({ component: Site }),
  contentTypes: createLazyRoute('/app/network/content-types/')({ component: ContentTypes }),
  newContentType: createLazyRoute('/app/network/content-types/new')({ component: NewContentType }),
  users: createLazyRoute('/app/network/users')({ component: Users }),
  roles: createLazyRoute('/app/network/roles')({ component: Roles }),
  appRoles: createLazyRoute('/app/network/roles/app')({ component: AppRoles }),
  appRole: createLazyRoute('/app/network/roles/app/$roleId')({ component: AppRoleEditor }),
  auditLog: createLazyRoute('/app/network/audit-log')({ component: AuditLog }),
};
