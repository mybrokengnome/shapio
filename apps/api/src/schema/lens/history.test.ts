import { describe, expect, it } from 'vitest';
import { activationsFromAudit, type HistoryAuditEvent } from './history.js';

const at = new Date('2026-11-10T00:00:00Z');
const event = (action: string, targetId: string, metadata: Record<string, unknown>): HistoryAuditEvent => ({
  action,
  target_id: targetId,
  metadata,
  occurred_at: at,
});

describe('activationsFromAudit', () => {
  const revisions = new Map([
    ['m:1', 'r1'],
    ['m:2', 'r2'],
    ['m:3', 'r3'],
  ]);

  it('maps activations to revisions, deletes to null, and scopes through later moves', () => {
    const rows = activationsFromAudit({
      events: [
        event('schema.activate', 'm', { toVersion: 1, schemaVersion: 4 }),
        event('schema.activate', 'm', { toVersion: 2, schemaVersion: 6 }),
        event('schema.activate', 'm', { toVersion: 3, schemaVersion: 9 }),
        event('schema.scope', 'm', { from: { siteId: 's1' }, to: 'network', schemaVersion: 9 }),
        event('schema.delete', 'm', { toVersion: null, schemaVersion: 12 }),
      ],
      revisions,
      scopes: new Map([['m', null]]),
      existing: new Set(['m:6']),
    });
    expect(
      rows.map(({ schemaVersion, siteId, revisionId }) => ({ schemaVersion, siteId, revisionId })),
    ).toEqual([
      { schemaVersion: 4, siteId: 's1', revisionId: 'r1' },
      { schemaVersion: 9, siteId: null, revisionId: 'r3' },
      { schemaVersion: 12, siteId: null, revisionId: null },
    ]);
    expect(rows.every((row) => row.backfilled && row.createdAt === at)).toBe(true);
  });

  it('skips models that are gone, revisions that are gone and rows without a schema version', () => {
    expect(
      activationsFromAudit({
        events: [
          event('schema.activate', 'gone', { toVersion: 1, schemaVersion: 2 }),
          event('schema.activate', 'm', { toVersion: 7, schemaVersion: 3 }),
          event('schema.activate', 'm', { toVersion: 1 }),
          { ...event('schema.activate', 'm', {}), metadata: '{"toVersion":2,"schemaVersion":5}' },
        ],
        revisions,
        scopes: new Map([['m', 's2']]),
        existing: new Set(),
      }).map((row) => [row.schemaVersion, row.revisionId, row.siteId]),
    ).toEqual([[5, 'r2', 's2']]);
  });
});
