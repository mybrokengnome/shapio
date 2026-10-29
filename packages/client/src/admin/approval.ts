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

/** Approval workflow settings (plan approval-workflows): the request's site's choice, and the instance default. */
export const createApprovalApi = (request: RequestFn) => ({
  site: {
    changeSets: {
      /** Any admin of the site. */
      get: () => request<SiteChangeSets>(APPROVAL_PATHS.siteChangeSets),
      /** `site.settings`; 409 `VERSION_CONFLICT` when the site changed since `expectedVersion`. */
      update: (body: UpdateSiteChangeSetsInput) =>
        request<SiteChangeSets>(APPROVAL_PATHS.siteChangeSets, { method: 'PUT', body }),
    },
  },
  network: {
    approval: {
      /** `sites.manage`. */
      get: () => request<NetworkApproval>(APPROVAL_PATHS.networkApproval),
      /** `sites.manage`; `mode: 'off'` turns approval off by default and keeps the stored workflow. */
      update: (body: UpdateNetworkApprovalInput) =>
        request<NetworkApproval>(APPROVAL_PATHS.networkApproval, { method: 'PUT', body }),
    },
  },
});
