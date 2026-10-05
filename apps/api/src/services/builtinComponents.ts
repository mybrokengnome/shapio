import { SEO_COMPONENT_API_KEY, SEO_COMPONENT_ID, seoComponentDefinition } from '@shapio/schema';
import { AppError } from '../helpers/appError.js';
import { loadSiteKeys } from '../schema/siteKeys.js';
import type { ActiveDefinition } from '../schema/snapshot.js';
import { assertCanCreate, type SchemaServiceContext } from './schemaAccess.js';
import { applyChange } from './schemaDefinitions.js';

/**
 * Built-in components (plan seo-fields): definitions Shapio knows by a fixed stable ID, created on first use
 * through the same change planner as any other (a schema version, visible in Schema as code, pullable).
 * They are always shared: a fixed ID is one `models` row, so a copy kept on one site would block every other.
 */
export type EnsureOutcome = {
  status: 'existing' | 'created';
  definitionId: string;
  version: number;
  schemaVersion: number;
};

const existing = (context: SchemaServiceContext, active: ActiveDefinition): EnsureOutcome => ({
  status: 'existing',
  definitionId: active.definition.id,
  version: active.version,
  schemaVersion: context.snapshot.version,
});

/** Another definition already holds the API ID in some view the shared component would join. */
const conflictOf = async (context: SchemaServiceContext) => {
  const taken = context.snapshot.network.definitions.find(
    (entry) =>
      entry.definition.id !== SEO_COMPONENT_ID &&
      entry.definition.apiKey.toLowerCase() === SEO_COMPONENT_API_KEY.toLowerCase(),
  );
  if (!taken) {
    return undefined;
  }
  const siteKey = taken.siteId === null ? null : ((await loadSiteKeys(context.db)).get(taken.siteId) ?? null);
  const where = siteKey === null ? 'shared with all sites' : `on site "${siteKey}"`;
  return new AppError(
    409,
    'SEO_COMPONENT_CONFLICT',
    `The API ID "${taken.definition.apiKey}" is already used by the ${taken.definition.kind} "${taken.definition.label}" ` +
      `(${where}). Rename or delete it, then add SEO fields again.`,
    {
      definitionId: taken.definition.id,
      apiKey: taken.definition.apiKey,
      kind: taken.definition.kind,
      label: taken.definition.label,
      scope: taken.siteId === null ? 'network' : 'site',
      siteKey,
    },
  );
};

/** The SEO component belongs to another site only: it cannot be shared from here. */
const elsewhere = () =>
  new AppError(
    409,
    'SEO_COMPONENT_CONFLICT',
    'The SEO component is kept on another site. A network admin can share it with all sites.',
    { definitionId: SEO_COMPONENT_ID, scope: 'site' },
  );

/**
 * Makes sure the built-in SEO component is in the request's view: returns it when it is (shared, or, for an
 * instance seeded before it was shared, the site's own), else creates it shared (needs `schema.create` on
 * every site). Idempotent: a concurrent create that won is returned as existing on the next call.
 */
export const ensureSeoComponent = async (context: SchemaServiceContext): Promise<EnsureOutcome> => {
  const inView = context.snapshot.byId.get(SEO_COMPONENT_ID);
  if (inView) {
    return existing(context, inView);
  }
  await assertCanCreate(context, null);
  if (context.snapshot.network.byId.has(SEO_COMPONENT_ID)) {
    throw elsewhere();
  }
  const conflict = await conflictOf(context);
  if (conflict) {
    throw conflict;
  }
  const outcome = await applyChange(context, {
    category: 'component',
    definition: seoComponentDefinition(),
    expectedVersion: null,
    scope: 'network',
  });
  if (outcome.status !== 'activated') {
    // A new component has no content, so no prerequisites: anything else is a programming error.
    throw new Error(`Creating the SEO component ended ${outcome.status}`);
  }
  return {
    status: 'created',
    definitionId: outcome.definitionId,
    version: outcome.version ?? 1,
    schemaVersion: outcome.schemaVersion,
  };
};
