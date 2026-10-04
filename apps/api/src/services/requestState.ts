import type { KnownVersions } from '../permissions/types.js';
import * as requestStateRepository from '../repositories/requestState.js';
import type { SiteLookup } from '../repositories/requestState.js';
import type { SiteRef } from './actorContext.js';

export type RequestVersions = Required<KnownVersions>;

export type RequestState = {
  /** The durable versions every cache of this request is checked against (ADR 0002, ADR 0005). */
  versions: RequestVersions;
  /** The looked-up site; undefined when none matches or no lookup was asked for. */
  site: SiteRef | undefined;
};

/** One statement on the pool: the schema and permissions versions, and the request's site when asked. */
export const readRequestState = async (lookup: SiteLookup | undefined): Promise<RequestState> => {
  const row = await requestStateRepository.read(lookup);
  return {
    versions: { schemaVersion: row.schemaVersion, permissionsVersion: row.permissionsVersion },
    site: row.site,
  };
};
