import type { PermissionEvaluator } from '../../../permissions/types.js';
import type { SiteRef } from '../../../services/actorContext.js';
import type { ContentServiceContext } from '../../../services/contentAccess.js';
import type { BatchReadOptions, DeliveryEntry } from '../../../services/contentBatchReads.js';
import type { SchemaSnapshot } from '../../snapshot.js';
import type { GraphqlLoaders } from './loaders.js';

/**
 * How the entries of one result were read; relation targets and `localizations` are read the same way
 * (same locale, fallback, state and snapshot), so a response is one consistent view.
 */
export type ReadScope = BatchReadOptions;

/** The source object of every entry and component type: the delivery projection plus its read scope. */
export type ValueNode = { data: Record<string, unknown>; scope: ReadScope };

/** Per-operation state, built by requestContext.ts. */
export type GraphqlRequestContext = {
  /** The request's evaluator, memoized per (model, action): one evaluation per request (ADR 0005). */
  permissions: PermissionEvaluator;
  /**
   * Records that a root field asked for drafts (`publicationState: DRAFT`), so the response is sent with
   * `cache-control: private, no-store`. Whether the caller may read drafts is the delivery service's check.
   */
  markDrafts: () => void;
  /** Whether any root field of the operation asked for drafts. */
  readDrafts: () => boolean;
  /**
   * The request's site (plugins/siteResolution.ts: the credential's, else `Shapio-Site` / `?site=`, else the
   * primary site). Every read, `_snapshot` and `_changes` are about this site, and the schema is its view.
   */
  site: SiteRef;
  loaders: GraphqlLoaders;
  /** The content service context of this request, built on first use. */
  content: (snapshot: SchemaSnapshot) => Promise<ContentServiceContext>;
};

export type GraphqlContext = GraphqlRequestContext;

/** An entry as a GraphQL source object. Drafts carry no publication time. */
export const entryNode = (entry: DeliveryEntry, scope: ReadScope): ValueNode => ({
  data: scope.drafts ? { ...entry, publishedAt: null } : entry,
  scope,
});
