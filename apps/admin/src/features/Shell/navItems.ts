import type { GlobalAction, NetworkAction } from '@shapio/client';
import type { ParseKeys } from 'i18next';
import {
  Activity,
  Blocks,
  Boxes,
  Braces,
  Camera,
  FileCode2,
  GitPullRequestArrow,
  Globe,
  Globe2,
  Image,
  Inbox,
  KeyRound,
  ScrollText,
  Send,
  Settings,
  ShieldCheck,
  SquareTerminal,
  Users,
  UsersRound,
  Webhook,
  type LucideIcon,
} from 'lucide-react';

/** What the admin may see, worked out once from `me` (helpers/modelPermissions). */
export type NavAccess = {
  globalPermissions: readonly GlobalAction[];
  /** Actions from roles on every site only (`schema.create` here means shared definitions and locales). */
  networkPermissions: readonly NetworkAction[];
  /** `schema.create`, or `schemaManage` on any model. */
  schema: boolean;
};

export type NavPath =
  | '/'
  | '/media'
  | '/publishing'
  | '/publishing/webhooks'
  | '/develop/components'
  | '/changes'
  | '/snapshots'
  | '/schema'
  | '/api-explorer'
  | '/develop/graphql'
  | '/live'
  | '/settings/api-tokens'
  | '/users/app'
  | '/settings/locales'
  | '/settings'
  | '/network/sites'
  | '/network/content-types'
  | '/network/users'
  | '/network/roles'
  | '/network/audit-log';

/**
 * `permission` counts site and network roles; `networkPermission` only roles on every site (for actions a
 * site role can also grant for its own site, such as `schema.create`, where the screen needs every site).
 */
type NavRequirement = { permission?: GlobalAction; networkPermission?: NetworkAction; schema?: boolean };

/** A fixed destination; `exact` items match only their own path (the Inbox at `/`). */
export type NavItemDefinition = NavRequirement & {
  key: string;
  labelKey: ParseKeys;
  icon: LucideIcon;
  to: NavPath;
  exact?: boolean;
};

export const isVisible = (item: NavRequirement, access: NavAccess) =>
  (!item.permission || access.globalPermissions.includes(item.permission)) &&
  (!item.networkPermission || access.networkPermissions.includes(item.networkPermission)) &&
  (!item.schema || access.schema);

/** Above the places: the Inbox is home for everyone. */
export const INBOX_ITEM = {
  key: 'inbox',
  labelKey: 'shell.nav.inbox',
  icon: Inbox,
  to: '/',
  exact: true,
} as const satisfies NavItemDefinition;

/** Below the places. */
export const CONTENT_ITEMS: readonly NavItemDefinition[] = [
  { key: 'media', labelKey: 'shell.nav.media', icon: Image, to: '/media', permission: 'media.read' },
  { key: 'publishing', labelKey: 'shell.nav.publishing', icon: Send, to: '/publishing' },
  // Change sets are how editors and developers ship together, so they sit with Publishing.
  {
    key: 'changes',
    labelKey: 'shell.nav.changes',
    icon: GitPullRequestArrow,
    to: '/changes',
    permission: 'changes.manage',
  },
];

/**
 * Developer areas (plan developer-face §2): the group shows only with tokens or webhooks management or a
 * schema permission (helpers/modelPermissions `canSeeDevelop`).
 */
export const DEVELOP_ITEMS: readonly NavItemDefinition[] = [
  {
    key: 'snapshots',
    labelKey: 'shell.nav.snapshots',
    icon: Camera,
    to: '/snapshots',
    permission: 'changes.manage',
  },
  { key: 'schema', labelKey: 'shell.nav.schema', icon: FileCode2, to: '/schema', schema: true },
  {
    key: 'components',
    labelKey: 'shell.nav.components',
    icon: Blocks,
    to: '/develop/components',
    schema: true,
  },
  { key: 'apiExplorer', labelKey: 'shell.nav.apiExplorer', icon: SquareTerminal, to: '/api-explorer' },
  { key: 'graphql', labelKey: 'shell.nav.graphql', icon: Braces, to: '/develop/graphql' },
  { key: 'live', labelKey: 'shell.nav.live', icon: Activity, to: '/live' },
  {
    key: 'apiTokens',
    labelKey: 'shell.nav.apiTokens',
    icon: KeyRound,
    to: '/settings/api-tokens',
    permission: 'tokens.manage',
  },
  {
    key: 'webhooks',
    labelKey: 'shell.nav.webhooks',
    icon: Webhook,
    to: '/publishing/webhooks',
    permission: 'webhooks.manage',
  },
];

/**
 * The site's own people (app users), the shared locales and settings, each with the permission its screen
 * needs. Admin users and roles are about every site: they are in the network view.
 */
export const WORKSPACE_ITEMS: readonly NavItemDefinition[] = [
  {
    key: 'appUsers',
    labelKey: 'shell.nav.appUsers',
    icon: UsersRound,
    to: '/users/app',
    permission: 'users.manage',
  },
  {
    key: 'locales',
    labelKey: 'shell.nav.locales',
    icon: Globe,
    to: '/settings/locales',
    // Locales are shared by every site, so only a role on every site may manage them.
    networkPermission: 'schema.create',
  },
  { key: 'settings', labelKey: 'shell.nav.settings', icon: Settings, to: '/settings' },
];

/** The network view (sites plan §H): about the whole instance rather than one site. */
export const NETWORK_ITEMS: readonly NavItemDefinition[] = [
  { key: 'sites', labelKey: 'shell.nav.sites', icon: Globe2, to: '/network/sites' },
  {
    key: 'contentTypes',
    labelKey: 'shell.nav.sharedContentTypes',
    icon: Boxes,
    to: '/network/content-types',
    networkPermission: 'schema.create',
  },
  {
    key: 'users',
    labelKey: 'shell.nav.users',
    icon: Users,
    to: '/network/users',
    permission: 'users.manage',
  },
  {
    key: 'roles',
    labelKey: 'shell.nav.roles',
    icon: ShieldCheck,
    to: '/network/roles',
    permission: 'roles.manage',
  },
  {
    key: 'auditLog',
    labelKey: 'shell.nav.auditLog',
    icon: ScrollText,
    to: '/network/audit-log',
    permission: 'audit.read',
  },
];
