import { SeoDefaultsSchema } from '@shapio/schema';
import { Type, type Static } from 'typebox';
import {
  ApprovalModeSchema,
  ApprovalWorkflowInputSchema,
  ApprovalWorkflowSchema,
} from '../../schemas/approvalWorkflow.js';
import { ErrorResponseSchema } from '../../schemas/error.js';
import { Nullable } from '../../schemas/publishing.js';

/** The request's site's SEO defaults and the site version an update must name. */
export const SiteSeoSchema = Type.Object({
  version: Type.Integer(),
  seo: SeoDefaultsSchema,
});

export const getSiteSeoSchema = {
  response: { 200: SiteSeoSchema, 403: ErrorResponseSchema, 404: ErrorResponseSchema },
};

export const UpdateSiteSeoBodySchema = Type.Object(
  { expectedVersion: Type.Integer({ minimum: 1 }), seo: SeoDefaultsSchema },
  { additionalProperties: false },
);
export type UpdateSiteSeoBody = Static<typeof UpdateSiteSeoBodySchema>;

export const updateSiteSeoSchema = {
  body: UpdateSiteSeoBodySchema,
  response: {
    200: SiteSeoSchema,
    400: ErrorResponseSchema,
    404: ErrorResponseSchema,
    409: ErrorResponseSchema,
  },
};

/** The request's site's change set settings (plan approval-workflows) and the site version an update must name. */
export const SiteChangeSetsSchema = Type.Object({
  version: Type.Integer(),
  /** `inherit` the instance default, `off`, or `custom` (the site's own workflow). */
  mode: ApprovalModeSchema,
  /** The site's own workflow, kept while another mode is chosen. */
  workflow: Nullable(ApprovalWorkflowSchema),
  /** The instance default the site would inherit. */
  inherited: Nullable(ApprovalWorkflowSchema),
  /** What applies now; null: change sets ship without approval. */
  effective: Nullable(ApprovalWorkflowSchema),
  /** Role IDs these workflows name that are no longer admin roles. */
  unknownRoleIds: Type.Array(Type.String()),
});

export const getSiteChangeSetsSchema = {
  response: { 200: SiteChangeSetsSchema, 403: ErrorResponseSchema, 404: ErrorResponseSchema },
};

export const UpdateSiteChangeSetsBodySchema = Type.Object(
  {
    expectedVersion: Type.Integer({ minimum: 1 }),
    mode: ApprovalModeSchema,
    /** The site's own workflow; omitted: the stored one is kept (`custom` needs one). */
    workflow: Type.Optional(ApprovalWorkflowInputSchema),
  },
  { additionalProperties: false },
);
export type UpdateSiteChangeSetsBody = Static<typeof UpdateSiteChangeSetsBodySchema>;

export const updateSiteChangeSetsSchema = {
  body: UpdateSiteChangeSetsBodySchema,
  response: {
    200: SiteChangeSetsSchema,
    400: ErrorResponseSchema,
    403: ErrorResponseSchema,
    404: ErrorResponseSchema,
    409: ErrorResponseSchema,
  },
};
