import { getDeliverySiteSchema } from '../../routes/site/schemas.js';

/**
 * `GET /api/site` in the OpenAPI document (plan seo-fields): the site's key, name and SEO defaults. Its schema
 * is the route's own TypeBox schema, never a second copy.
 */
export const SITE_TAG = { name: 'Site', description: "The request's site and its SEO defaults" };

const errorRef = { $ref: '#/components/schemas/Error' };

export const sitePaths = (): Record<string, unknown> => ({
  '/api/site': {
    get: {
      tags: [SITE_TAG.name],
      summary: "The site's key, name and SEO defaults (texts per locale, default image, Twitter handle)",
      operationId: 'getSite',
      responses: {
        '200': {
          description: 'OK',
          content: { 'application/json': { schema: getDeliverySiteSchema.response[200] } },
        },
        '401': {
          description: 'Anonymous, and the public role may read nothing on this site',
          content: { 'application/json': { schema: errorRef } },
        },
      },
    },
  },
});
