import type { Kysely, Transaction } from 'kysely';
import type { DB } from '../db/types.js';
import type { Principal } from '../permissions/types.js';
import * as auditEventsRepository from '../repositories/auditEvents.js';

type Executor = Kysely<DB> | Transaction<DB>;

export type AuditActorType = 'admin' | 'app_user' | 'token' | 'anonymous' | 'system';

export type AuditInput = {
  actor: Principal;
  /** Dotted, past-tense-free verb phrase, e.g. `schema.activate`, `session.revoke`. */
  action: string;
  target?: { type: string; id: string };
  outcome?: 'success' | 'failure';
  /** Never put secrets here: tokens, passwords and cookies must be redacted by the caller. */
  metadata?: Record<string, unknown>;
  requestId?: string;
  ip?: string;
};

const describeActor = (actor: Principal): { actorType: AuditActorType; actorId: string | null } => {
  switch (actor.kind) {
    case 'admin':
      return { actorType: 'admin', actorId: actor.adminUserId };
    case 'appUser':
      return { actorType: 'app_user', actorId: actor.appUserId };
    case 'token':
      return { actorType: 'token', actorId: actor.tokenId };
    case 'anonymous':
      return { actorType: 'anonymous', actorId: null };
    case 'system':
      return { actorType: 'system', actorId: actor.component };
  }
};

/**
 * Records an audit event. Pass the transaction that performs the audited change so the event commits
 * (or rolls back) with it (change and audit row in one transaction).
 */
export const recordAudit = async (trx: Executor, input: AuditInput) => {
  const { actorType, actorId } = describeActor(input.actor);
  return auditEventsRepository.insert(
    {
      actor_type: actorType,
      actor_id: actorId,
      action: input.action,
      target_type: input.target?.type ?? null,
      target_id: input.target?.id ?? null,
      outcome: input.outcome ?? 'success',
      metadata: JSON.stringify(input.metadata ?? {}),
      request_id: input.requestId ?? null,
      ip: input.ip ?? null,
    },
    trx,
  );
};
