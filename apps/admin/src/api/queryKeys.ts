import type {
  AppUserQuery,
  AuditQuery,
  ContentHealthQuery,
  ContentListQuery,
  DefinitionCategory,
  DeploymentRunQuery,
  JobQuery,
  MediaAssetQuery,
  ScheduleQuery,
} from '@shapio/client';

/** Every TanStack Query key in the admin, so invalidation targets are explicit. */
export const queryKeys = {
  setupStatus: ['setup', 'status'] as const,
  me: ['auth', 'me'] as const,
  sessions: ['auth', 'sessions'] as const,
  users: ['users'] as const,
  invitationInspect: (token: string) => ['invitations', 'inspect', token] as const,
  invitations: ['invitations'] as const,
  roles: ['roles'] as const,
  /** App users (end users of the user's sites) and their roles (package I). */
  appUsers: {
    all: ['appUsers'] as const,
    list: (query: AppUserQuery) => ['appUsers', 'list', query] as const,
  },
  appRoles: {
    all: ['appRoles'] as const,
    role: (id: string) => ['appRoles', id] as const,
  },
  tokens: ['tokens'] as const,
  /** Sites (network view) and each site's app role bindings. */
  sites: {
    all: ['sites'] as const,
    site: (id: string) => ['sites', id] as const,
    appRoles: (id: string) => ['sites', id, 'appRoles'] as const,
  },
  audit: {
    all: ['audit'] as const,
    list: (query: AuditQuery) => ['audit', 'list', query] as const,
  },
  /** The media library; invalidate `media.all` after uploads and edits. */
  media: {
    all: ['media'] as const,
    folders: ['media', 'folders'] as const,
    assets: (query: Omit<MediaAssetQuery, 'cursor'>) => ['media', 'assets', query] as const,
    asset: (id: string) => ['media', 'asset', id] as const,
    usage: (id: string) => ['media', 'usage', id] as const,
  },
  /** Everything derived from the schema snapshot; invalidate `schema.all` when the schema version moves. */
  schema: {
    all: ['schema'] as const,
    summary: ['schema', 'summary'] as const,
    settings: ['schema', 'settings'] as const,
    locales: ['schema', 'locales'] as const,
    definitions: (category: DefinitionCategory) => ['schema', 'definitions', category] as const,
    definition: (category: DefinitionCategory, id: string) =>
      ['schema', 'definitions', category, id] as const,
    change: (changeId: string) => ['schema', 'changes', changeId] as const,
  },
  /** Entries per model; invalidate `content.model(key)` after any write to that model. */
  content: {
    all: ['content'] as const,
    model: (modelKey: string) => ['content', modelKey] as const,
    list: (modelKey: string, query: ContentListQuery) => ['content', modelKey, 'list', query] as const,
    entry: (modelKey: string, id: string, locale: string | undefined) =>
      ['content', modelKey, 'entry', id, locale ?? null] as const,
    revisions: (modelKey: string, id: string, locale: string | undefined) =>
      ['content', modelKey, 'revisions', id, locale ?? null] as const,
    revision: (modelKey: string, id: string, revisionId: string) =>
      ['content', modelKey, 'revision', id, revisionId] as const,
  },
  /** Change sets, the snapshot ledger and delivery usage (developer pages, plan developer-face). */
  develop: {
    changeSets: {
      all: ['develop', 'changeSets'] as const,
      list: (status: string) => ['develop', 'changeSets', 'list', status] as const,
      set: (id: string) => ['develop', 'changeSets', 'set', id] as const,
      review: (id: string) => ['develop', 'changeSets', 'review', id] as const,
      timeline: (id: string) => ['develop', 'changeSets', 'timeline', id] as const,
      draft: (id: string, definitionId: string) =>
        ['develop', 'changeSets', 'draft', id, definitionId] as const,
      unassigned: ['develop', 'changeSets', 'unassigned'] as const,
    },
    snapshots: {
      all: ['develop', 'snapshots'] as const,
      list: (cursor: string | undefined) => ['develop', 'snapshots', 'list', cursor ?? null] as const,
      snapshot: (seq: number) => ['develop', 'snapshots', 'snapshot', seq] as const,
      changes: (from: number, to: number) => ['develop', 'snapshots', 'changes', from, to] as const,
      ledger: ['develop', 'snapshots', 'ledger'] as const,
      /** One place read through delivery as it was at `seq`, in one locale. */
      place: (seq: number, routeKey: string, locale: string) =>
        ['develop', 'snapshots', 'place', seq, routeKey, locale] as const,
    },
    /**
     * One page of health findings per model for a change set's Checks (a plain query, so it can't share
     * `contentHealth.list`, which is an infinite query); under `contentHealth` so its invalidation hits it.
     */
    setHealthFindings: (query: ContentHealthQuery) => ['contentHealth', 'changeSet', query] as const,
    usage: {
      all: ['develop', 'usage'] as const,
      model: (modelId: string, days: number) => ['develop', 'usage', 'model', modelId, days] as const,
    },
  },
  /** Editor assists: on/off and usage (rarely changes), and content-ops runs by ID. */
  assist: {
    status: ['assist', 'status'] as const,
    run: (runId: string) => ['assist', 'runs', runId] as const,
  },
  /** Open content health findings (the Inbox) and entries per model (the sidebar's places). */
  contentHealth: {
    all: ['contentHealth'] as const,
    list: (query: ContentHealthQuery) => ['contentHealth', 'list', query] as const,
    summary: ['contentHealth', 'summary'] as const,
  },
  contentCounts: ['contentCounts'] as const,
  /** The live snapshot number (delivery route; the Inbox's "Recently published" diffs back from it). */
  currentSnapshot: ['snapshots', 'current'] as const,
  /**
   * Who has entries open: a model's list rows (`presence(modelKey)`) or one entry (`presence(modelKey, id)`).
   * The entry key extends the model key, so invalidating a model's presence refreshes both.
   */
  presence: (modelKey: string, entryId?: string) =>
    entryId === undefined ? (['presence', modelKey] as const) : (['presence', modelKey, entryId] as const),
  /** The entry document's pre-flight (E1); never cached across opens. */
  entryDocument: {
    preflight: (modelKey: string, id: string, locale: string | undefined) =>
      ['entryDocument', 'preflight', modelKey, id, locale ?? null] as const,
  },
  /** Custom field editors installed in the project (read once per session). */
  editorManifest: ['extensions', 'editors'] as const,
  /** Jobs, schedules, webhooks and deployments (package H). */
  publishing: {
    jobs: {
      all: ['publishing', 'jobs'] as const,
      list: (query: JobQuery) => ['publishing', 'jobs', 'list', query] as const,
      summary: ['publishing', 'jobs', 'summary'] as const,
    },
    schedules: {
      all: ['publishing', 'schedules'] as const,
      list: (query: ScheduleQuery) => ['publishing', 'schedules', 'list', query] as const,
    },
    webhooks: {
      all: ['publishing', 'webhooks'] as const,
      list: ['publishing', 'webhooks', 'list'] as const,
      events: ['publishing', 'webhooks', 'events'] as const,
      webhook: (id: string) => ['publishing', 'webhooks', 'webhook', id] as const,
      deliveries: (id: string, cursor: string | undefined) =>
        ['publishing', 'webhooks', 'deliveries', id, cursor ?? null] as const,
    },
    deployments: {
      all: ['publishing', 'deployments'] as const,
      connections: ['publishing', 'deployments', 'connections'] as const,
      connection: (id: string) => ['publishing', 'deployments', 'connections', id] as const,
      runs: (query: DeploymentRunQuery) => ['publishing', 'deployments', 'runs', 'list', query] as const,
      run: (id: string) => ['publishing', 'deployments', 'runs', 'run', id] as const,
      /** The connections previews open on: under `deployments`, so connection changes refresh it. */
      previewTargets: ['publishing', 'deployments', 'previewTargets'] as const,
    },
  },
};
