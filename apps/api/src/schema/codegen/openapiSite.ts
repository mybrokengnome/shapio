import { getDeliverySiteSchema } from '../../routes/site/schemas.js';

/**
 * `GET /api/workspace` in the OpenAPI document (plan seo-fields, plan workspace-rename): the workspace's key,
 * name and SEO defaults. Its schema is the route's own TypeBox schema, never a second copy. `GET /api/site`,
 * the same route under its original name, stays in the document as deprecated, with its original tag and
 * operationId, so clients generated from an older document keep their names.
 */
export const WORKSPACE_TAG = {
  name: 'Workspace',
  description: "The request's workspace and its SEO defaults",
};

/** The original tag of `GET /api/site`, kept so generated clients keep grouping it where they did. */
export const SITE_TAG = {
  name: 'Site',
  description: 'Kept for compatibility: `GET /api/site` is `GET /api/workspace` under its original name',
};

const errorRef = { $ref: '#/components/schemas/Error' };

const workspaceOperation = (tag: string, operationId: string) => ({
  tags: [tag],
  summary: "The workspace's key, name and SEO defaults (texts per locale, default image, Twitter handle)",
  operationId,
  responses: {
    '200': {
      description: 'OK',
      content: { 'application/json': { schema: getDeliverySiteSchema.response[200] } },
    },
    '401': {
      description: 'Anonymous, and the public role may read nothing on this workspace',
      content: { 'application/json': { schema: errorRef } },
    },
  },
});

export const sitePaths = (): Record<string, unknown> => ({
  '/api/workspace': { get: workspaceOperation(WORKSPACE_TAG.name, 'getWorkspace') },
  '/api/site': {
    get: {
      ...workspaceOperation(SITE_TAG.name, 'getSite'),
      description: 'The original name of `GET /api/workspace`; it answers the same and keeps working.',
      deprecated: true,
    },
  },
});
