/** Accounts the e2e specs share (one server and database per run; specs run in file order). */
export const OWNER = { name: 'Ada Lovelace', email: 'ada@example.com', password: 'analytical-engine-1843' };
/** The owner's password after admin4Auth.spec.ts's password-reset test. */
export const NEW_PASSWORD = 'difference-engine-1822';
/**
 * The built-in workspace's name (key `default`): the setup screen names it, and `signInAsOwner`'s setup
 * through the API sends the same name, so every shard sees it.
 */
export const BUILT_IN_WORKSPACE = 'Default workspace';
