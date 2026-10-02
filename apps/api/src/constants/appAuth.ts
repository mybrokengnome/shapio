/** App-user authentication settings (package I, ADR 0005) that are not configurable by env on purpose. */

/** `aud` of every app-user access token; tokens for anything else are rejected. */
export const APP_TOKEN_AUDIENCE = 'shapio-app';

/** App-user passwords: NIST SP 800-63B minimum for user-chosen passwords; same upper bound as admins. */
export const APP_PASSWORD_MIN_LENGTH = 8;

export const APP_EMAIL_CONFIRMATION_TTL_MS = 3 * 24 * 60 * 60 * 1000;
export const APP_PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;

/** OAuth: how long the browser may take at the provider, and how long the app has to exchange its code. */
export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
export const OAUTH_LOGIN_CODE_TTL_MS = 60 * 1000;
export const OAUTH_STATE_COOKIE_NAME = 'shapio_oauth';
/** Outbound calls to OAuth providers give up after this long. */
export const OAUTH_HTTP_TIMEOUT_MS = 10_000;

/**
 * A rotated refresh token may be presented once more within this window (a client that lost the response
 * retries) and gets the same replacement; any other reuse revokes the whole family.
 */
export const REFRESH_REUSE_GRACE_MS = 10_000;

/** Resolved app-user principals kept per (user, permissions version), so a moved version costs one lookup. */
export const APP_PRINCIPAL_CACHE_SIZE = 10_000;
