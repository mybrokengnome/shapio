import type { Principal } from '../permissions/types.js';

/** The site a request or job is about (sites plan §H): its stable ID and its key. */
export type SiteRef = { id: string; key: string };

/** Who is acting and the request it came from: recorded on audit events. Carries no HTTP objects. */
export type ActorContext = {
  actor: Principal;
  requestId?: string;
  ip?: string;
  /** The site of a site-scoped request; recorded on its audit events. Absent on network routes. */
  site?: SiteRef;
};

/** The context of a site-scoped service call: the site is required, so every query can be scoped by it. */
export type SiteActorContext = ActorContext & { site: SiteRef };

/** Client details stored on a new session, shown in the session list. */
export type ClientInfo = { ip: string | undefined; userAgent: string | undefined };

export const SYSTEM_CLI_ACTOR: ActorContext = { actor: { kind: 'system', component: 'cli' } };
