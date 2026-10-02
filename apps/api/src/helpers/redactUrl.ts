/** Query parameters that carry credentials: signed media URLs, OAuth callbacks, preview and link tokens. */
const SECRET_QUERY_PARAMS = new Set([
  'signature',
  'code',
  'state',
  'token',
  'access_token',
  'refresh_token',
  'password',
]);

const REDACTED = '[redacted]';

/**
 * A request URL safe to log: the values of credential-bearing query parameters are replaced. Paths are
 * kept as they are (Shapio never puts a secret in a path segment).
 */
export const redactUrlSecrets = (url: string): string => {
  const queryStart = url.indexOf('?');
  if (queryStart === -1) {
    return url;
  }
  const params = new URLSearchParams(url.slice(queryStart + 1));
  let changed = false;
  for (const name of [...params.keys()]) {
    if (SECRET_QUERY_PARAMS.has(name.toLowerCase())) {
      params.set(name, REDACTED);
      changed = true;
    }
  }
  return changed ? `${url.slice(0, queryStart)}?${params.toString()}` : url;
};
