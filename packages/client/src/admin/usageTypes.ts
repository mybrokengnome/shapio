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
