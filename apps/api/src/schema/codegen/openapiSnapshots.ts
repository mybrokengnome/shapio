import { currentSnapshotSchema, snapshotChangesSchema } from '../../routes/snapshots/schemas.js';

/**
 * `/api/snapshots/*` in the OpenAPI document (plan developer-face §5). These routes do not depend on the
 * models, so their schemas are the routes' own TypeBox schemas (plain JSON Schema), never a second copy.
 */
export const SNAPSHOTS_TAG = {
  name: 'Snapshots',
  description: 'Publication snapshots and what changed between two (incremental builds)',
};

const errorRef = { $ref: '#/components/schemas/Error' };
const errors = {
  '400': { description: 'Invalid query', content: { 'application/json': { schema: errorRef } } },
  '401': {
    description: 'Anonymous, and the public role may read nothing',
    content: { 'application/json': { schema: errorRef } },
  },
};
const ok = (schema: unknown) => ({ description: 'OK', content: { 'application/json': { schema } } });

/** Querystring properties as OpenAPI parameters. */
const queryParameters = (schema: { properties: object; required?: readonly string[] }) =>
  Object.entries(schema.properties as Record<string, unknown>).map(([name, property]) => ({
    name,
    in: 'query',
    required: schema.required?.includes(name) ?? false,
    schema: property,
  }));

export const snapshotPaths = (): Record<string, unknown> => ({
  '/api/snapshots/current': {
    get: {
      tags: [SNAPSHOTS_TAG.name],
      summary: 'The current publication snapshot and schema version',
      operationId: 'getCurrentSnapshot',
      responses: { '200': ok(currentSnapshotSchema.response[200]), ...errors },
    },
  },
  '/api/snapshots/changes': {
    get: {
      tags: [SNAPSHOTS_TAG.name],
      summary: 'Entries whose live content changed between two snapshots, by locale',
      operationId: 'listSnapshotChanges',
      parameters: queryParameters(snapshotChangesSchema.querystring),
      responses: { '200': ok(snapshotChangesSchema.response[200]), ...errors },
    },
  },
});
