import { SITE_HEADERS, SITE_QUERY_PARAMETERS } from '../constants/sites.js';
import { AppError } from './appError.js';

/**
 * How a request names its workspace (code: site). There are two spellings of each, the workspace one and the
 * original site one, accepted forever: the `Shapio-Workspace` / `Shapio-Site` headers and the `?workspace=` /
 * `?site=` query parameters. Every reader (site resolution, the raw query for the content compiler, in-process
 * delivery, the GraphQL playground) goes through this module, so the spellings and the mismatch rule cannot
 * drift apart.
 */

/** One place a workspace key may come from, with its name for error messages (`?site=`, `the … header`). */
export type SiteKeyCandidate = { source: string; value: unknown };

const QUERY_PARAMETER_NAMES: ReadonlySet<string> = new Set(SITE_QUERY_PARAMETERS);

/** `shapio-workspace` → `Shapio-Workspace`, as the docs spell it. */
const headerLabel = (name: string): string =>
  name
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('-');

const capitalize = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/** The single key a candidate names; undefined when unset or empty. A repeated parameter is refused (400). */
const keyOf = ({ source, value }: SiteKeyCandidate): string | undefined => {
  if (Array.isArray(value)) {
    throw new AppError(
      400,
      'INVALID_QUERY',
      capitalize(`${source} is given more than once; name one workspace`),
    );
  }
  return typeof value === 'string' && value.length > 0 ? value : undefined;
};

/**
 * The workspace key the candidates name, or undefined when none does. Every candidate that is set must name
 * the same key: two that differ (header and header, header and query, query and query) are refused with
 * 403 `SITE_MISMATCH`, naming both sources. A repeated parameter (an array value) is 400 `INVALID_QUERY`.
 */
export const pickSiteKey = (candidates: readonly SiteKeyCandidate[]): string | undefined => {
  let picked: { source: string; key: string } | undefined;
  for (const candidate of candidates) {
    const key = keyOf(candidate);
    if (key === undefined) {
      continue;
    }
    if (picked && picked.key !== key) {
      throw new AppError(
        403,
        'SITE_MISMATCH',
        capitalize(`${picked.source} and ${candidate.source} name different workspaces`),
      );
    }
    picked ??= { source: candidate.source, key };
  }
  return picked?.key;
};

/** The workspace headers of a request (`Shapio-Workspace`, then `Shapio-Site`). */
export const siteHeaderCandidates = (headers: Record<string, unknown>): SiteKeyCandidate[] =>
  SITE_HEADERS.map((name) => ({ source: `the ${headerLabel(name)} header`, value: headers[name] }));

/** The workspace query parameters of a parsed query (`?workspace=`, then `?site=`). */
export const siteQueryCandidates = (query: Record<string, unknown> | undefined): SiteKeyCandidate[] =>
  SITE_QUERY_PARAMETERS.map((name) => ({ source: `?${name}=`, value: query?.[name] }));

/**
 * The workspace query parameters of a raw querystring (without `?`), parsed like the server parses one: a
 * repeated parameter becomes an array, so `pickSiteKey` refuses it.
 */
export const rawSiteQueryCandidates = (rawQuery: string): SiteKeyCandidate[] => {
  const params = new URLSearchParams(rawQuery);
  return siteQueryCandidates(
    Object.fromEntries(
      SITE_QUERY_PARAMETERS.map((name) => {
        const values = params.getAll(name);
        return [name, values.length > 1 ? values : values[0]];
      }),
    ),
  );
};

/**
 * Removes both workspace parameters from a parsed query, in place: site resolution consumes them, so a route's
 * strict querystring schema never sees them.
 */
export const deleteSiteParameters = (query: Record<string, unknown> | undefined): void => {
  if (!query || typeof query !== 'object') {
    return;
  }
  for (const name of SITE_QUERY_PARAMETERS) {
    delete query[name];
  }
};

const isSiteSegment = (segment: string): boolean => {
  const key = segment.split('=', 1)[0] ?? '';
  try {
    return QUERY_PARAMETER_NAMES.has(decodeURIComponent(key.replace(/\+/g, ' ')));
  } catch {
    return false;
  }
};

/**
 * A raw querystring (without `?`) without its `workspace` and `site` parameters: site resolution consumes them,
 * and the content compiler refuses unknown keys. The rest is left exactly as sent (bracket syntax is the
 * compiler's to parse).
 */
export const withoutSiteParameter = (rawQuery: string): string =>
  rawQuery
    .split('&')
    .filter((segment) => !isSiteSegment(segment))
    .join('&');
