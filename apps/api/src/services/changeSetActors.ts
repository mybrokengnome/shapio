/** Who did something to a change set, as its views show it: an admin, an admin API token, or the system. */
export type ChangeSetActorView = {
  type: 'admin' | 'token' | 'system';
  id: string | null;
  name: string | null;
};

export const actorOfIds = (
  adminId: string | null,
  tokenId: string | null,
  names: ReadonlyMap<string, string>,
): ChangeSetActorView => {
  if (adminId) {
    return { type: 'admin', id: adminId, name: names.get(adminId) ?? null };
  }
  if (tokenId) {
    return { type: 'token', id: tokenId, name: names.get(tokenId) ?? null };
  }
  return { type: 'system', id: null, name: null };
};
