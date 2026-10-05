import type { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, createRoute, createRouter, redirect } from '@tanstack/react-router';
import { meQueryOptions } from '@/api/auth';
import { AcceptInvitation } from '@/features/AcceptInvitation';
import { apiExplorerSearchSchema } from '@/features/Develop/ApiExplorer/searchSchema';
import { changeSetSearchSchema } from '@/features/Develop/ChangeSet/searchSchema';
import { graphqlSearchSchema } from '@/features/Develop/Graphql/searchSchema';
import { schemaSearchSchema } from '@/features/Develop/Schema/searchSchema';
import { snapshotSearchSchema, snapshotsSearchSchema } from '@/features/Develop/Snapshots/searchSchema';
import { ForgotPassword } from '@/features/ForgotPassword';
import { Login } from '@/features/Login';
import { NotFound } from '@/features/NotFound';
import { firstPermittedSection } from '@/features/Publishing/sections';
import { ResetPassword } from '@/features/ResetPassword';
import { RouteError } from '@/features/RouteError';
import { Setup } from '@/features/Setup';
import { Shell } from '@/features/Shell';
import { AppUsers } from '@/features/Users/AppUsers';
import { safeRedirectPath } from '@/helpers/safeRedirect';
import { routerBasePath } from './basePath';
import { currentSite } from './currentSite';
import {
  redirectComponentBuilder,
  redirectModelBuilder,
  redirectModelsIndex,
  redirectNewModel,
} from './modelRedirects';
import { requireNetworkPermission, requireNetworkView } from './networkGuards';
import { RootLayout } from './RootLayout';
import {
  redirectIfSignedIn,
  redirectToSetupIfPending,
  requireSession,
  requireSetupPending,
} from './routeGuards';
import {
  appUsersSearchSchema,
  auditSearchSchema,
  contentListSearchSchema,
  cursorSearchSchema,
  entrySearchSchema,
  loginSearchSchema,
  mediaSearchSchema,
  modelsSearchSchema,
  newModelSearchSchema,
  schedulesSearchSchema,
} from './searchSchemas';
import { createSiteRewrite } from './siteRewrite';

export type RouterContext = { queryClient: QueryClient };

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
  notFoundComponent: NotFound,
});

// Signed-out screens
const setupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'setup',
  beforeLoad: ({ context }) => requireSetupPending(context.queryClient),
  component: Setup,
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'login',
  validateSearch: loginSearchSchema,
  beforeLoad: async ({ context, search }) => {
    await redirectToSetupIfPending(context.queryClient);
    await redirectIfSignedIn(context.queryClient, safeRedirectPath(search.redirect));
  },
  component: Login,
});

const forgotPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'forgot-password',
  component: ForgotPassword,
});

const resetPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'reset-password',
  component: ResetPassword,
});

const acceptInvitationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'accept-invitation',
  component: AcceptInvitation,
});

// Signed-in screens, inside the shell
const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'app',
  beforeLoad: ({ context, location }) => requireSession(context.queryClient, location.href),
  component: Shell,
});

/** The Inbox is home for everyone (plan editor-experience §9). */
const homeRoute = createRoute({ getParentRoute: () => appRoute, path: '/' }).lazy(() =>
  import('./lazyRoutes/inbox').then((module) => module.inboxLazyRoute),
);

/** Admin users moved to the network view (sites plan §H); old links keep working. */
const usersRoute = createRoute({
  getParentRoute: () => appRoute,
  path: 'users',
  beforeLoad: () => {
    throw redirect({ to: '/network/users', replace: true });
  },
});

const appUsersRoute = createRoute({
  getParentRoute: () => appRoute,
  path: 'users/app',
  validateSearch: appUsersSearchSchema,
  component: AppUsers,
});

// `/models/*` only redirects now: builders are the Structure tab of a place, components live under Develop.
const modelsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: 'models',
  validateSearch: modelsSearchSchema,
  beforeLoad: ({ search }) => redirectModelsIndex(search.tab),
});

const newModelRoute = createRoute({
  getParentRoute: () => appRoute,
  path: 'models/new',
  validateSearch: newModelSearchSchema,
  beforeLoad: ({ search }) => redirectNewModel(search.kind),
});

const modelBuilderRoute = createRoute({
  getParentRoute: () => appRoute,
  path: 'models/$modelId',
  beforeLoad: ({ context, params }) => redirectModelBuilder(context.queryClient, params.modelId),
});

const componentBuilderRoute = createRoute({
  getParentRoute: () => appRoute,
  path: 'models/components/$componentId',
  beforeLoad: ({ params }) => redirectComponentBuilder(params.componentId),
});

// New content types and components, and Develop → Components.
const contentTypesLazy = () =>
  import('./lazyRoutes/contentTypes').then((module) => module.contentTypesLazyRoutes);

const newContentTypeRoute = createRoute({ getParentRoute: () => appRoute, path: 'content/new' }).lazy(() =>
  contentTypesLazy().then((routes) => routes.newContentType),
);

const componentsRoute = createRoute({ getParentRoute: () => appRoute, path: 'develop/components' }).lazy(() =>
  contentTypesLazy().then((routes) => routes.components),
);

const newComponentRoute = createRoute({
  getParentRoute: () => appRoute,
  path: 'develop/components/new',
}).lazy(() => contentTypesLazy().then((routes) => routes.newComponent));

const componentRoute = createRoute({
  getParentRoute: () => appRoute,
  path: 'develop/components/$componentId',
}).lazy(() => contentTypesLazy().then((routes) => routes.component));

const mediaRoute = createRoute({
  getParentRoute: () => appRoute,
  path: 'media',
  validateSearch: mediaSearchSchema,
}).lazy(() => import('./lazyRoutes/media').then((module) => module.mediaLazyRoute));

// Content (package F): entry lists and forms. Models are data, so routes carry the model's API key.
const contentLazy = () => import('./lazyRoutes/content').then((module) => module.contentLazyRoutes);

const contentRoute = createRoute({ getParentRoute: () => appRoute, path: 'content' }).lazy(() =>
  contentLazy().then((routes) => routes.home),
);

const modelContentRoute = createRoute({
  getParentRoute: () => appRoute,
  path: 'content/$modelKey',
  validateSearch: contentListSearchSchema,
}).lazy(() => contentLazy().then((routes) => routes.model));

const newEntryRoute = createRoute({
  getParentRoute: () => appRoute,
  path: 'content/$modelKey/new',
  validateSearch: entrySearchSchema,
}).lazy(() => contentLazy().then((routes) => routes.newEntry));

const entryRoute = createRoute({
  getParentRoute: () => appRoute,
  path: 'content/$modelKey/$entryId',
  validateSearch: entrySearchSchema,
}).lazy(() => contentLazy().then((routes) => routes.entry));

// Route-level code splitting: these screens (and @shapio/schema with Models and Locales) load on first visit.
const settingsLazy = () => import('./lazyRoutes/settings').then((module) => module.settingsLazyRoutes);

const settingsRoute = createRoute({ getParentRoute: () => appRoute, path: 'settings' }).lazy(() =>
  settingsLazy().then((routes) => routes.settings),
);

const settingsIndexRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/settings/profile', replace: true });
  },
});

type SettingsLazyKey = keyof Awaited<ReturnType<typeof settingsLazy>>;

const settingsChild = <TPath extends string>(path: TPath, key: SettingsLazyKey) =>
  createRoute({ getParentRoute: () => settingsRoute, path }).lazy(() =>
    settingsLazy().then((routes) => routes[key]),
  );

const profileRoute = settingsChild('profile', 'profile');
const sessionsRoute = settingsChild('sessions', 'sessions');
const appearanceRoute = settingsChild('theme', 'theme');
const localesRoute = settingsChild('locales', 'locales');
const seoRoute = settingsChild('seo', 'seo');
const assistRoute = settingsChild('assist', 'assist');
const apiTokensRoute = settingsChild('api-tokens', 'apiTokens');

// Roles and the audit log moved to the network view (sites plan §H); old links keep working.
const rolesRedirectRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: 'roles',
  beforeLoad: () => {
    throw redirect({ to: '/network/roles', replace: true });
  },
});

const appRolesRedirectRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: 'roles/app',
  beforeLoad: () => {
    throw redirect({ to: '/network/roles/app', replace: true });
  },
});

const appRoleRedirectRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: 'roles/app/$roleId',
  beforeLoad: ({ params }) => {
    throw redirect({ to: '/network/roles/app/$roleId', params, replace: true });
  },
});

const auditLogRedirectRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: 'audit-log',
  validateSearch: auditSearchSchema,
  beforeLoad: ({ search }) => {
    throw redirect({ to: '/network/audit-log', search, replace: true });
  },
});

// The network view (sites plan §H): sites, admin users, roles and the audit log, about the whole instance.
const networkLazy = () => import('./lazyRoutes/network').then((module) => module.networkLazyRoutes);

type NetworkLazyKey = keyof Awaited<ReturnType<typeof networkLazy>>;

const networkRoute = createRoute({
  getParentRoute: () => appRoute,
  path: 'network',
  beforeLoad: ({ context }) => requireNetworkView(context.queryClient),
});

const networkIndexRoute = createRoute({
  getParentRoute: () => networkRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/network/sites', replace: true });
  },
});

const networkChild = <TPath extends string>(path: TPath, key: NetworkLazyKey) =>
  createRoute({ getParentRoute: () => networkRoute, path }).lazy(() =>
    networkLazy().then((routes) => routes[key]),
  );

const sitesRoute = networkChild('sites', 'sites');
const siteRoute = networkChild('sites/$siteId', 'site');
const networkUsersRoute = networkChild('users', 'users');
const networkRolesRoute = networkChild('roles', 'roles');
const networkAppRolesRoute = networkChild('roles/app', 'appRoles');
const networkAppRoleRoute = networkChild('roles/app/$roleId', 'appRole');

// Shared content types need schema.create on every site (any other network action opens the view).
const networkContentTypesRoute = createRoute({
  getParentRoute: () => networkRoute,
  path: 'content-types',
  beforeLoad: ({ context }) => requireNetworkPermission(context.queryClient, 'schema.create'),
});
const networkContentTypesIndexRoute = createRoute({
  getParentRoute: () => networkContentTypesRoute,
  path: '/',
}).lazy(() => networkLazy().then((routes) => routes.contentTypes));
const networkNewContentTypeRoute = createRoute({
  getParentRoute: () => networkContentTypesRoute,
  path: 'new',
}).lazy(() => networkLazy().then((routes) => routes.newContentType));

const networkAuditLogRoute = createRoute({
  getParentRoute: () => networkRoute,
  path: 'audit-log',
  validateSearch: auditSearchSchema,
}).lazy(() => networkLazy().then((routes) => routes.auditLog));

// Publishing (package H): scheduled publications, deployments and webhooks.
const publishingLazy = () => import('./lazyRoutes/publishing').then((module) => module.publishingLazyRoutes);

type PublishingLazyKey = keyof Awaited<ReturnType<typeof publishingLazy>>;

const publishingRoute = createRoute({ getParentRoute: () => appRoute, path: 'publishing' }).lazy(() =>
  publishingLazy().then((routes) => routes.publishing),
);

/** `/publishing` opens the first section the admin may use. */
const publishingIndexRoute = createRoute({
  getParentRoute: () => publishingRoute,
  path: '/',
  beforeLoad: async ({ context }) => {
    const me = await context.queryClient.ensureQueryData(meQueryOptions);
    throw redirect({ to: firstPermittedSection(me?.globalPermissions ?? []), replace: true });
  },
});

const publishingChild = <TPath extends string>(path: TPath, key: PublishingLazyKey) =>
  createRoute({ getParentRoute: () => publishingRoute, path }).lazy(() =>
    publishingLazy().then((routes) => routes[key]),
  );

const scheduledRoute = createRoute({
  getParentRoute: () => publishingRoute,
  path: 'scheduled',
  validateSearch: schedulesSearchSchema,
}).lazy(() => publishingLazy().then((routes) => routes.scheduled));

const deploymentsRoute = createRoute({
  getParentRoute: () => publishingRoute,
  path: 'deployments',
  validateSearch: cursorSearchSchema,
}).lazy(() => publishingLazy().then((routes) => routes.deployments));

const connectionRoute = createRoute({
  getParentRoute: () => publishingRoute,
  path: 'deployments/$connectionId',
  validateSearch: cursorSearchSchema,
}).lazy(() => publishingLazy().then((routes) => routes.connection));

const runRoute = publishingChild('deployments/runs/$runId', 'run');
const webhooksRoute = publishingChild('webhooks', 'webhooks');

const webhookRoute = createRoute({
  getParentRoute: () => publishingRoute,
  path: 'webhooks/$webhookId',
  validateSearch: cursorSearchSchema,
}).lazy(() => publishingLazy().then((routes) => routes.webhook));

// Develop (plan developer-face): change sets, snapshots, live usage, schema as code, API explorer, GraphQL.
const developLazy = () => import('./lazyRoutes/develop').then((module) => module.developLazyRoutes);

type DevelopLazyKey = keyof Awaited<ReturnType<typeof developLazy>>;

const developRoute = <TPath extends string>(path: TPath, key: DevelopLazyKey) =>
  createRoute({ getParentRoute: () => appRoute, path }).lazy(() =>
    developLazy().then((routes) => routes[key]),
  );

const changesRoute = developRoute('changes', 'changes');

const changeSetRoute = createRoute({
  getParentRoute: () => appRoute,
  path: 'changes/$changeSetId',
  validateSearch: changeSetSearchSchema,
}).lazy(() => developLazy().then((routes) => routes.changeSet));

const snapshotsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: 'snapshots',
  validateSearch: snapshotsSearchSchema,
}).lazy(() => developLazy().then((routes) => routes.snapshots));

const snapshotRoute = createRoute({
  getParentRoute: () => appRoute,
  path: 'snapshots/$seq',
  validateSearch: snapshotSearchSchema,
}).lazy(() => developLazy().then((routes) => routes.snapshot));

const liveRoute = developRoute('live', 'live');
const schemaRoute = createRoute({
  getParentRoute: () => appRoute,
  path: 'schema',
  validateSearch: schemaSearchSchema,
}).lazy(() => developLazy().then((routes) => routes.schema));

const apiExplorerRoute = createRoute({
  getParentRoute: () => appRoute,
  path: 'api-explorer',
  validateSearch: apiExplorerSearchSchema,
}).lazy(() => developLazy().then((routes) => routes.apiExplorer));

const graphqlRoute = createRoute({
  getParentRoute: () => appRoute,
  path: 'develop/graphql',
  validateSearch: graphqlSearchSchema,
}).lazy(() => developLazy().then((routes) => routes.graphql));

const routeTree = rootRoute.addChildren([
  setupRoute,
  loginRoute,
  forgotPasswordRoute,
  resetPasswordRoute,
  acceptInvitationRoute,
  appRoute.addChildren([
    homeRoute,
    usersRoute,
    appUsersRoute,
    modelsRoute,
    newModelRoute,
    modelBuilderRoute,
    componentBuilderRoute,
    newContentTypeRoute,
    componentsRoute,
    newComponentRoute,
    componentRoute,
    mediaRoute,
    contentRoute,
    modelContentRoute,
    newEntryRoute,
    entryRoute,
    changesRoute,
    changeSetRoute,
    snapshotsRoute,
    snapshotRoute,
    liveRoute,
    schemaRoute,
    apiExplorerRoute,
    graphqlRoute,
    publishingRoute.addChildren([
      publishingIndexRoute,
      scheduledRoute,
      deploymentsRoute,
      connectionRoute,
      runRoute,
      webhooksRoute,
      webhookRoute,
    ]),
    settingsRoute.addChildren([
      settingsIndexRoute,
      profileRoute,
      sessionsRoute,
      appearanceRoute,
      localesRoute,
      seoRoute,
      assistRoute,
      rolesRedirectRoute,
      appRolesRedirectRoute,
      appRoleRedirectRoute,
      apiTokensRoute,
      auditLogRedirectRoute,
    ]),
    networkRoute.addChildren([
      networkIndexRoute,
      sitesRoute,
      siteRoute,
      networkContentTypesRoute.addChildren([networkContentTypesIndexRoute, networkNewContentTypeRoute]),
      networkUsersRoute,
      networkRolesRoute,
      networkAppRolesRoute,
      networkAppRoleRoute,
      networkAuditLogRoute,
    ]),
  ]),
]);

export const createAppRouter = (queryClient: QueryClient) =>
  createRouter({
    routeTree,
    basepath: routerBasePath(),
    // The address bar carries the site (`/admin/s/blog/...`); routes are site-free (app/siteRewrite).
    rewrite: createSiteRewrite(() => currentSite().key),
    context: { queryClient },
    defaultPreload: 'intent',
    defaultErrorComponent: RouteError,
    // Route data comes from TanStack Query; the router shouldn't cache it a second time.
    defaultPreloadStaleTime: 0,
    scrollRestoration: true,
  });

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
