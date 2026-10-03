import { AppError } from '../helpers/appError.js';
import * as auditLogRepository from '../repositories/auditLog.js';
import type { AuditLogCursor, AuditLogFilter } from '../repositories/auditLog.js';

export const AUDIT_PAGE_DEFAULT = 50;
export const AUDIT_PAGE_MAX = 200;

export type AuditEventView = {
  id: string;
  occurredAt: Date;
  actorType: string;
  actorId: string | null;
  /** Display name of an admin or API token actor; null for others, or when the actor no longer exists. */
  actorName: string | null;
  /** Email of an admin actor; null otherwise. */
  actorEmail: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  outcome: string;
  requestId: string | null;
  ip: string | null;
  metadata: unknown;
};

export type AuditLogPage = { items: AuditEventView[]; nextCursor: string | null };

const encodeCursor = (cursor: AuditLogCursor): string =>
  Buffer.from(JSON.stringify([cursor.occurredAt, cursor.seq]), 'utf8').toString('base64url');

/** A cursor from before `audit_events.seq` (its second part an event ID) is rejected like any invalid one. */
const decodeCursor = (value: string): AuditLogCursor => {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (
      Array.isArray(parsed) &&
      parsed.length === 2 &&
      typeof parsed[0] === 'string' &&
      !Number.isNaN(Date.parse(parsed[0])) &&
      typeof parsed[1] === 'string' &&
      /^\d{1,19}$/.test(parsed[1])
    ) {
      return { occurredAt: parsed[0], seq: parsed[1] };
    }
  } catch {
    // Fall through to the error below: a malformed cursor is the caller's mistake, not ours.
  }
  throw new AppError(400, 'INVALID_CURSOR', 'The cursor is not valid');
};

/** One page of the audit log, newest first, with an opaque cursor for the next page. */
export const listAuditEvents = async (
  filter: AuditLogFilter,
  options: { cursor?: string; limit?: number },
): Promise<AuditLogPage> => {
  const limit = Math.min(Math.max(options.limit ?? AUDIT_PAGE_DEFAULT, 1), AUDIT_PAGE_MAX);
  const cursor = options.cursor ? decodeCursor(options.cursor) : undefined;
  const rows = await auditLogRepository.listEvents(filter, cursor, limit + 1);
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    items: page.map((row) => ({
      id: row.id,
      occurredAt: row.occurred_at,
      actorType: row.actor_type,
      actorId: row.actor_id,
      actorName: row.actor_name,
      actorEmail: row.actor_email,
      action: row.action,
      targetType: row.target_type,
      targetId: row.target_id,
      outcome: row.outcome,
      requestId: row.request_id,
      ip: row.ip,
      metadata: row.metadata,
    })),
    nextCursor:
      rows.length > limit && last ? encodeCursor({ occurredAt: last.cursor_at, seq: last.seq }) : null,
  };
};
