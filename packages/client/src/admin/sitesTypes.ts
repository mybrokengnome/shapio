/** A workspace: the tenant of content, media, tokens, change sets and snapshots (sites plan §H). */
export type Site = {
  id: string;
  /** Lower case, starts with a letter; fixed once created. Sent as `Shapio-Site` or `?site=`. */
  key: string;
  name: string;
  /** Requests that name no workspace go to the primary workspace. Exactly one; it cannot be deleted. */
  isPrimary: boolean;
  /**
   * Ships and schedules approved change sets only: the workspace has an effective approval workflow (its own or
   * the inherited default; plan approval-workflows). Read-only; see `admin.workspace.changeSets`.
   */
  requireApproval: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type SiteSummary = Pick<Site, 'id' | 'key' | 'name' | 'isPrimary'>;

/** A workspace as webhook payloads and views name it. */
export type SiteRef = Pick<Site, 'id' | 'key'>;

export type CreateSiteInput = { key: string; name: string };

/** Only the name changes; `expectedVersion` guards against concurrent edits (409 `VERSION_CONFLICT`). */
export type UpdateSiteInput = { expectedVersion: number; name: string };

/**
 * The app roles a workspace binds: `public` applies to anonymous callers, `authenticated` to every signed-in
 * app user of the workspace. A new workspace binds nothing (deny by default).
 */
export type SiteAppRoles = { siteId: string; public: string[]; authenticated: string[] };

export type SetSiteAppRolesInput = { public: string[]; authenticated: string[] };

/*
 * The workspace names of the types above (`site*` field names in payloads stay: they name the workspace).
 * The `Site*` names remain and are the same types.
 */
export type Workspace = Site;
export type WorkspaceSummary = SiteSummary;
export type WorkspaceRef = SiteRef;
export type CreateWorkspaceInput = CreateSiteInput;
export type UpdateWorkspaceInput = UpdateSiteInput;
export type WorkspaceAppRoles = SiteAppRoles;
export type SetWorkspaceAppRolesInput = SetSiteAppRolesInput;
