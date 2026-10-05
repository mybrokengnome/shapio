import { SeoDefaultsSchema } from '@shapio/schema';
import { Type, type Static } from 'typebox';
import { ErrorResponseSchema } from '../../schemas/error.js';

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
