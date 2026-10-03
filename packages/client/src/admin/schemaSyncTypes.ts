import type { LockFile, SchemaChange, SchemaDefinition, SyncDecision } from '@shapio/schema';

/**
 * Schema sync (`/api/admin/schema/export|apply`, ADR 0002): the pull format `shapio schema pull` writes and
 * the three-way apply `shapio schema apply` sends. Shared by the CLI and @shapio/mcp.
 */
export type SchemaExport = {
  schemaVersion: number;
  definitions: Array<{ definition: SchemaDefinition; version: number; hash: string }>;
};

export type SchemaSyncResult = {
  definitionId: string;
  apiKey: string;
  kind: SchemaDefinition['kind'];
  decision: SyncDecision;
  changes: SchemaChange[];
  outcome?: 'activated' | 'pending' | 'skipped';
  version?: number | null;
  changeId?: string;
  plan?: { summary?: { breaking?: boolean; destructive?: boolean; prerequisites?: string[] } };
};

export type SchemaApplyResult = { schemaVersion: number; dryRun: boolean; results: SchemaSyncResult[] };

export type SchemaApplyInput = {
  /** Definition files as read (untrusted JSON; the server parses and validates them). */
  definitions: unknown[];
  /** The lock file the files came from: the versions the local copy is based on. */
  base: LockFile;
  prune: boolean;
  dryRun: boolean;
  acknowledgeBreaking: boolean;
  acknowledgeDestructive: boolean;
};
