import type { Principal } from '../permissions/types.js';

/** Who is acting and the request it came from: recorded on audit events. Carries no HTTP objects. */
export type ActorContext = {
  actor: Principal;
  requestId?: string;
  ip?: string;
};

/** Client details stored on a new session, shown in the session list. */
export type ClientInfo = { ip: string | undefined; userAgent: string | undefined };

export const SYSTEM_CLI_ACTOR: ActorContext = { actor: { kind: 'system', component: 'cli' } };
