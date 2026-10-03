import { Type, type Static } from 'typebox';
import { SITE_KEY_PATTERN } from '../../../constants/sites.js';
import { DateTimeSchema, IdParamsSchema, UuidSchema } from '../../schemas/adminIdentity.js';
import { ErrorResponseSchema } from '../../schemas/error.js';

export const SiteKeySchema = Type.String({ pattern: SITE_KEY_PATTERN });

export const SiteSchema = Type.Object({
  id: UuidSchema,
  key: Type.String(),
  name: Type.String(),
  /** The site requests fall back to when nothing names one. Exactly one; it cannot be deleted. */
  isPrimary: Type.Boolean(),
  version: Type.Integer(),
  createdAt: DateTimeSchema,
  updatedAt: DateTimeSchema,
});

/** What `me` and the site switcher show: enough to name and address a site. */
export const SiteSummarySchema = Type.Object({
  id: UuidSchema,
  key: Type.String(),
  name: Type.String(),
  isPrimary: Type.Boolean(),
});

export const listSitesSchema = { response: { 200: Type.Array(SiteSchema) } };
export const getSiteSchema = {
  params: IdParamsSchema,
  response: { 200: SiteSchema, 404: ErrorResponseSchema },
};

export const CreateSiteBodySchema = Type.Object(
  {
    key: SiteKeySchema,
    name: Type.String({ minLength: 1, maxLength: 200 }),
  },
  { additionalProperties: false },
);
export type CreateSiteBody = Static<typeof CreateSiteBodySchema>;

export const createSiteSchema = {
  body: CreateSiteBodySchema,
  response: { 201: SiteSchema, 400: ErrorResponseSchema, 409: ErrorResponseSchema },
};

/** The key is fixed once created (it is a contract: URLs, tokens' `?site=`, starters' config). */
export const UpdateSiteBodySchema = Type.Object(
  {
    expectedVersion: Type.Integer({ minimum: 1 }),
    name: Type.String({ minLength: 1, maxLength: 200 }),
  },
  { additionalProperties: false },
);
export type UpdateSiteBody = Static<typeof UpdateSiteBodySchema>;

export const updateSiteSchema = {
  params: IdParamsSchema,
  body: UpdateSiteBodySchema,
  response: { 200: SiteSchema, 404: ErrorResponseSchema, 409: ErrorResponseSchema },
};

/** Only an empty site can be deleted (409 `SITE_NOT_EMPTY`); the primary site never (409 `SITE_IS_PRIMARY`). */
export const deleteSiteSchema = {
  params: IdParamsSchema,
  response: { 204: Type.Null(), 404: ErrorResponseSchema, 409: ErrorResponseSchema },
};
