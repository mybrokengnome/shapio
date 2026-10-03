import { Type, type Static } from 'typebox';
import { IdParamsSchema, UuidSchema } from '../../schemas/adminIdentity.js';
import { ErrorResponseSchema } from '../../schemas/error.js';

const BoundRolesSchema = Type.Array(UuidSchema, { maxItems: 50 });

/** The app roles a site binds: `public` for anonymous callers, `authenticated` for every signed-in app user. */
export const SiteAppRolesSchema = Type.Object({
  siteId: UuidSchema,
  public: BoundRolesSchema,
  authenticated: BoundRolesSchema,
});

export const getSiteAppRolesSchema = {
  params: IdParamsSchema,
  response: { 200: SiteAppRolesSchema, 404: ErrorResponseSchema },
};

export const SetSiteAppRolesBodySchema = Type.Object(
  { public: BoundRolesSchema, authenticated: BoundRolesSchema },
  { additionalProperties: false },
);
export type SetSiteAppRolesBody = Static<typeof SetSiteAppRolesBodySchema>;

export const setSiteAppRolesSchema = {
  params: IdParamsSchema,
  body: SetSiteAppRolesBodySchema,
  response: { 200: SiteAppRolesSchema, 400: ErrorResponseSchema, 404: ErrorResponseSchema },
};
