/**
 * mysql2, loaded on first use. A process on PostgreSQL never loads it, and a bundle of the read path (the
 * in-process delivery runtime) can leave it out as an optional dependency.
 */
export const loadMysql = async () => (await import('mysql2')).default;
