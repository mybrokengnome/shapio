import type { RequestFn } from '../request.js';
import type {
  NetworkApproval,
  SiteChangeSets,
  UpdateNetworkApprovalInput,
  UpdateSiteChangeSetsInput,
} from './approvalTypes.js';

export const APPROVAL_PATHS = {
  siteChangeSets: '/api/admin/site/change-sets',
  networkApproval: '/api/admin/network/approval',
} as const;

const createWorkspaceGroup = (request: RequestFn) => ({
  changeSets: {
    /** Any admin of the workspace. */
    get: () => request<SiteChangeSets>(APPROVAL_PATHS.siteChangeSets),
    /** `site.settings`; 409 `VERSION_CONFLICT` when the workspace changed since `expectedVersion`. */
    update: (body: UpdateSiteChangeSetsInput) =>
      request<SiteChangeSets>(APPROVAL_PATHS.siteChangeSets, { method: 'PUT', body }),
  },
});

const createNetworkGroup = (request: RequestFn) => ({
  approval: {
    /** `sites.manage`. */
    get: () => request<NetworkApproval>(APPROVAL_PATHS.networkApproval),
    /** `sites.manage`; `mode: 'off'` turns approval off by default and keeps the stored workflow. */
    update: (body: UpdateNetworkApprovalInput) =>
      request<NetworkApproval>(APPROVAL_PATHS.networkApproval, { method: 'PUT', body }),
  },
});

/**
 * Approval workflow settings (plan approval-workflows): the request's workspace's choice (`workspace`, also as
 * `site`), and the instance default.
 */
export const createApprovalApi = (request: RequestFn) => {
  const workspace = createWorkspaceGroup(request);
  return {
    workspace,
    /** The older name of `workspace`. */
    site: workspace,
    network: createNetworkGroup(request),
  };
};
