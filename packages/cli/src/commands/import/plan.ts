/** The import plan as the server returns it (apps/api content/transfer/plan.ts `ImportDiff`), as far as the CLI reads it. */
type Conflict = { id: string; model?: string; reason: string; detail?: string };
type SchemaItem = { id: string; apiKey: string; kind: string; reason?: string };
type Counted = { added: number; updated: number; unchanged: number };

export type MediaFileNeed = {
  assetId: string;
  storageKey: string;
  sha256: string | null;
  sizeBytes: number;
  mimeType: string;
};

export type ImportDiff = {
  locales: {
    added: string[];
    changed: string[];
    unchanged: string[];
    defaultLocale: { from: string; to: string; blocked: boolean } | null;
  };
  schema: { added: SchemaItem[]; unchanged: SchemaItem[]; conflicts: SchemaItem[] };
  /** `droppedGrants`: absent from servers before this field existed. */
  appRoles: { added: string[]; updated: string[]; unchanged: string[]; droppedGrants?: DroppedGrants[] };
  deliveryRoles: {
    added: string[];
    updated: string[];
    unchanged: string[];
    conflicts: string[];
    droppedGrants?: DroppedGrants[];
  };
  appUsers: { added: number; unchanged: number; conflicts: Conflict[]; conflictCount: number };
  webhooks: { added: string[]; unchanged: string[] };
  deploymentConnections: { added: string[]; unchanged: string[]; needSecrets: string[] };
  media: {
    folders: { added: number; unchanged: number };
    added: number;
    unchanged: number;
    conflicts: Conflict[];
    conflictCount: number;
    files: MediaFileNeed[];
  };
  entries: Counted & {
    conflicts: Conflict[];
    conflictCount: number;
    byModel: Record<string, Counted & { conflicts: number }>;
  };
  prune: { entries: number } | null;
  conflicts: number;
};

const list = (items: readonly string[]) => (items.length > 0 ? ` (${items.join(', ')})` : '');

const SCHEMA_REASONS: Readonly<Record<string, string>> = {
  existsOnTarget: 'the target has it in another form',
};

type DroppedGrants = { role: string; modelIds: string[] };

const droppedLine = ({ role, modelIds }: DroppedGrants) =>
  `  - role ${role}: left out its grants on ${modelIds.length} model(s) neither the bundle nor this instance has`;

const conflictLine = (kind: string, conflict: Conflict) =>
  `  ! ${kind} ${conflict.id}${conflict.model ? ` (${conflict.model})` : ''}: ${conflict.reason}${conflict.detail ? `: ${conflict.detail}` : ''}`;

/** A readable summary of the plan, one line per category plus every listed conflict. */
export const formatPlan = (diff: ImportDiff): string => {
  const lines = [
    `Locales: ${diff.locales.added.length} added${list(diff.locales.added)}, ${diff.locales.changed.length} changed${list(diff.locales.changed)}, ${diff.locales.unchanged.length} unchanged`,
    ...(diff.locales.defaultLocale
      ? [
          `  default locale ${diff.locales.defaultLocale.from} → ${diff.locales.defaultLocale.to}${diff.locales.defaultLocale.blocked ? ' (refused: the target has content)' : ''}`,
        ]
      : []),
    `Models and components: ${diff.schema.added.length} added${list(diff.schema.added.map((item) => item.apiKey))}, ${diff.schema.unchanged.length} unchanged, ${diff.schema.conflicts.length} conflicting`,
    ...diff.schema.conflicts.map(
      (item) =>
        `  ! ${item.kind} ${item.apiKey}: ${SCHEMA_REASONS[item.reason ?? ''] ?? item.reason ?? 'differs'} (reconcile the schemas first: shapio schema pull/apply)`,
    ),
    `App roles: ${diff.appRoles.added.length} added, ${diff.appRoles.updated.length} updated, ${diff.appRoles.unchanged.length} unchanged`,
    ...(diff.appRoles.droppedGrants ?? []).map(droppedLine),
    `Delivery roles: ${diff.deliveryRoles.added.length} added, ${diff.deliveryRoles.updated.length} updated, ${diff.deliveryRoles.unchanged.length} unchanged, ${diff.deliveryRoles.conflicts.length} conflicting (tokens are never imported: create new ones)`,
    ...diff.deliveryRoles.conflicts.map(
      (key) => `  ! role ${key}: the target uses this key for an admin role`,
    ),
    ...(diff.deliveryRoles.droppedGrants ?? []).map(droppedLine),
    `App users: ${diff.appUsers.added} added, ${diff.appUsers.unchanged} unchanged, ${diff.appUsers.conflictCount} conflicting`,
    ...diff.appUsers.conflicts.map((conflict) => conflictLine('user', conflict)),
    `Webhooks: ${diff.webhooks.added.length} added (disabled, new secrets), ${diff.webhooks.unchanged.length} unchanged`,
    `Deployment connections: ${diff.deploymentConnections.added.length} added (disabled; enter their secrets), ${diff.deploymentConnections.unchanged.length} unchanged`,
    `Media: ${diff.media.folders.added} folders and ${diff.media.added} assets added, ${diff.media.unchanged} unchanged, ${diff.media.conflictCount} conflicting`,
    ...diff.media.conflicts.map((conflict) => conflictLine('asset', conflict)),
    `Entries: ${diff.entries.added} added, ${diff.entries.updated} updated, ${diff.entries.unchanged} unchanged, ${diff.entries.conflictCount} conflicting`,
    ...Object.entries(diff.entries.byModel).map(
      ([model, counts]) =>
        `  ${model}: ${counts.added} added, ${counts.updated} updated, ${counts.unchanged} unchanged, ${counts.conflicts} conflicting`,
    ),
    ...diff.entries.conflicts.map((conflict) => conflictLine('entry', conflict)),
    ...(diff.prune ? [`Prune: ${diff.prune.entries} target entries not in the bundle would be deleted`] : []),
    diff.conflicts > 0
      ? `${diff.conflicts} conflict(s): the import would be refused and nothing written.`
      : 'No conflicts.',
  ];
  return `${lines.join('\n')}\n`;
};
