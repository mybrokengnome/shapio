import type { LensEffect } from '@shapio/schema';
import type { SiteRef } from './sitesTypes.js';

/** Field usage from delivery traffic (`GET /api/admin/usage/fields`, apps/api/src/routes/admin/usage). */
export type UsageSelection = 'explicit' | 'implicit';

export type FieldUsageQuery = {
  modelId: string;
  /** Days counted, today included (default 7; capped at USAGE_RETENTION_DAYS). */
  days?: number;
};

export type FieldPrincipalUsage = {
  /** `token:<id>`, `app_users` or `anonymous`. */
  principalKey: string;
  /** The API token's name (tokens only, while the token exists). */
  tokenName?: string;
  reads: number;
  lastReadAt: string;
  /** `implicit`: every read asked for the whole model (no field selection). */
  selection: UsageSelection;
};

export type ModelFieldUsage = {
  /** A field ID, or `<relation field ID>.<target field ID>` for a populated relation's field. */
  fieldPath: string;
  /** API keys along the path in the current schema (`author.name`); null when a field no longer exists. */
  apiKeyPath: string | null;
  reads: number;
  lastReadAt: string;
  principals: FieldPrincipalUsage[];
};

export type PrincipalUsageSummary = {
  principalKey: string;
  tokenName?: string;
  /** Delivery requests over all models in the window. */
  requests: number;
  lastReadAt: string;
  /** The snapshot this principal last pinned with `snapshot`; null when it reads live content. */
  lastSnapshot: number | null;
};

export type FieldUsageResponse = {
  /** False when USAGE_TRACKING is off (nothing new is counted). */
  tracking: boolean;
  modelId: string;
  days: number;
  /** First day counted (UTC, `YYYY-MM-DD`). */
  since: string;
  fields: ModelFieldUsage[];
  principals: PrincipalUsageSummary[];
};

/** `GET /api/admin/usage/schema-versions` (plan schema-lenses; needs `tokens.manage`). */
export type SchemaVersionReader = {
  /** `token:<id>`, `app_users` or `anonymous`. */
  principalKey: string;
  tokenName?: string;
  /** The schema version the reader's latest request was served at: one it named, or its token's pin. */
  schemaVersion: number;
  /** The version is the token's pin, not one the client sends. */
  pinned: boolean;
  lastReadAt: string;
};

export type SchemaVersionsResponse = {
  /** False when USAGE_TRACKING is off (nothing new is counted). */
  tracking: boolean;
  /** Readers on the workspace whose latest request named a schema version, most recent first. */
  principals: SchemaVersionReader[];
};

export type { LensEffect };

export type OlderClientReader = {
  /** The workspace the reads were made on. */
  site: SiteRef;
  /** `token:<id>`, `app_users` or `anonymous`. */
  principalKey: string;
  /** The token's name; null for app users, anonymous readers and deleted tokens. */
  label: string | null;
  /** The version is the token's pin, not one the client sends. */
  pinned: boolean;
  /** Null: a token pinned to the version that has not read since (a declared older client). */
  lastReadAt: string | null;
};

export type OlderClientDefinition = {
  definitionId: string;
  /** The definition's API ID in the client's version. */
  apiKey: string;
  /** `unavailable`: no record of the definition at that version (reads of it answer 409). */
  status: 'available' | 'unavailable';
  /** The worst effect over its fields; null when unavailable. */
  effect: LensEffect | null;
  /** The oldest version reads of it work from, when unavailable. */
  oldestVersion: number | null;
  /** The client's fields that do not keep working unchanged; every other field reads as before. */
  fields: OlderClientField[];
  /** Too many changes since the version to check what they did to stored values: `effect` is the shape's. */
  historyTruncated: boolean;
};

export type OlderClientField = {
  fieldId: string;
  /** The field's API ID in the client's version. */
  apiKey: string;
  /** What the client sees once the change is live: shape and every step's effect on stored values. */
  effect: LensEffect;
  /** The proposed change's own part: what it makes worse than today. */
  proposedEffect: LensEffect;
  /** What the client already sees today (shape since its version, values activations dropped or cut). */
  pastEffect: LensEffect;
  /** The schema version since which `pastEffect` holds; null when transparent or not datable. */
  pastSince: number | null;
};

export type OlderClientVersion = {
  schemaVersion: number;
  /** Readers on that version; null when the viewer may not see token names (needs `tokens.manage`). */
  readers: OlderClientReader[] | null;
  /** Readers on that version the viewer sees in detail (with or without names). */
  readerCount: number;
  /** Readers on workspaces the viewer does not see in detail; null when it sees every workspace. */
  otherSites: { consumers: number } | null;
  definitions: OlderClientDefinition[];
};

/**
 * Readers on older schema versions and what they see once a proposed change is live (change set review and
 * plan preview): per version readers are on now, the composite effect from that version to the proposal.
 */
export type OlderClients = {
  /** Most recently used first; at most a fixed number of versions. */
  versions: OlderClientVersion[];
  /** More versions are in use than the review compiled. */
  truncated: boolean;
};
