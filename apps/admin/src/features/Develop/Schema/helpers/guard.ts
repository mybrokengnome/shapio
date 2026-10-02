import {
  decideSync,
  serializeDefinition,
  type SchemaDefinition,
  type SyncConflictReason,
  type SyncDecision,
} from '@shapio/schema';
import type { ExportedDefinition, SchemaDraftInput, SchemaExport } from '@/api/schemaFiles';
import type { SchemaFile } from './files';

/**
 * The three-way guard of `shapio schema apply` (ADR 0002), run in the browser before anything is written:
 * the base is what the file was loaded from, local is the edited file, remote is the instance now.
 * Unchanged files are skipped, files changed only here become drafts, and a file whose definition also
 * moved on the instance refuses the whole apply, like a rejected non-fast-forward push.
 *
 * Sides are compared by their canonical serialization (what the lock file's hash is a SHA-256 of), so the
 * guard needs no Web Crypto: `crypto.subtle` is missing when the admin is opened over plain HTTP on a LAN.
 */
export type LocalDefinition = { definition: SchemaDefinition };

export type GuardItem = { file: SchemaFile; local: LocalDefinition };

export type GuardConflict = {
  file: SchemaFile;
  local: LocalDefinition;
  remote: ExportedDefinition | undefined;
  reason: SyncConflictReason;
};

export type GuardResult =
  | { status: 'conflict'; conflicts: GuardConflict[] }
  | { status: 'ready'; drafts: SchemaDraftInput[]; skipped: number };

const draftOf = (
  item: GuardItem,
  decision: Extract<SyncDecision, { action: 'create' | 'update' }>,
): SchemaDraftInput => ({
  definitionId: item.file.definitionId,
  category: item.file.category,
  definition: item.local.definition,
  baseVersion: decision.action === 'update' ? decision.expectedVersion : null,
});

export const guardApply = (items: readonly GuardItem[], remote: SchemaExport): GuardResult => {
  const remoteById = new Map(remote.definitions.map((entry) => [entry.definition.id, entry]));
  const conflicts: GuardConflict[] = [];
  const drafts: SchemaDraftInput[] = [];
  let skipped = 0;
  for (const item of items) {
    const target = remoteById.get(item.file.definitionId);
    const decision = decideSync({
      local: { definition: item.local.definition, hash: serializeDefinition(item.local.definition) },
      base: { version: item.file.base.version, hash: item.file.base.text },
      remote: target
        ? {
            version: target.version,
            hash: serializeDefinition(target.definition),
            definition: target.definition,
          }
        : undefined,
      prune: false,
    });
    switch (decision.action) {
      case 'conflict':
        conflicts.push({ file: item.file, local: item.local, remote: target, reason: decision.reason });
        break;
      case 'create':
      case 'update':
        drafts.push(draftOf(item, decision));
        break;
      default:
        skipped += 1;
    }
  }
  return conflicts.length > 0 ? { status: 'conflict', conflicts } : { status: 'ready', drafts, skipped };
};
