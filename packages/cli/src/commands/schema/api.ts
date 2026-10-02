import type { ShapioClient } from '@shapio/client';
import type { LockFile, SchemaChange, SchemaDefinition, SyncDecision } from '@shapio/schema';

/** The schema sync endpoints (`/api/admin/schema/*`), typed for the CLI. */
export type ExportResponse = {
  schemaVersion: number;
  definitions: Array<{ definition: SchemaDefinition; version: number; hash: string }>;
};

export type SyncResultItem = {
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

export type ApplyResponse = { schemaVersion: number; dryRun: boolean; results: SyncResultItem[] };

export type ApplyRequest = {
  definitions: unknown[];
  base: LockFile;
  prune: boolean;
  dryRun: boolean;
  acknowledgeBreaking: boolean;
  acknowledgeDestructive: boolean;
};

export type ChangeStatus = { id: string; status: string; error: unknown };

export const schemaApi = (client: ShapioClient) => ({
  export: () => client.request<ExportResponse>('/api/admin/schema/export'),
  apply: (body: ApplyRequest) =>
    client.request<ApplyResponse>('/api/admin/schema/apply', { method: 'POST', body }),
  change: (id: string) => client.request<ChangeStatus>(`/api/admin/schema/changes/${encodeURIComponent(id)}`),
});
