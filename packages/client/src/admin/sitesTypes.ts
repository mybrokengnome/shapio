/** A site: the tenant of content, media, tokens, change sets and snapshots (sites plan §H). */
export type Site = {
  id: string;
  /** Lower case, starts with a letter; fixed once created. Sent as `Shapio-Site` or `?site=`. */
  key: string;
  name: string;
  /** Requests that name no site go to the primary site. Exactly one; it cannot be deleted. */
  isPrimary: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type SiteSummary = Pick<Site, 'id' | 'key' | 'name' | 'isPrimary'>;

export type CreateSiteInput = { key: string; name: string };

/** Only the name changes; `expectedVersion` guards against concurrent edits (409 `VERSION_CONFLICT`). */
export type UpdateSiteInput = { expectedVersion: number; name: string };
