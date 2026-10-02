/** Admin authentication settings (ADR 0005). Not configurable by env on purpose: safe defaults for everyone. */

export const SESSION_COOKIE_NAME = 'shapio_session';

/** A session dies after this long without a request. */
export const SESSION_IDLE_TIMEOUT_MS = 12 * 60 * 60 * 1000;
/** A session dies this long after login, however active it is. */
export const SESSION_ABSOLUTE_TIMEOUT_MS = 7 * 24 * 60 * 60 * 1000;
/** `last_seen_at` / `last_used_at` are written at most this often, so reads stay reads. */
export const LAST_SEEN_WRITE_INTERVAL_MS = 60 * 1000;

export const CSRF_HEADER = 'x-csrf-token';

export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;

export const PASSWORD_MIN_LENGTH = 12;
/** argon2 accepts more, but unbounded input is a denial-of-service vector. */
export const PASSWORD_MAX_LENGTH = 256;

/** API tokens carry a recognisable prefix (secret scanners, and telling them apart from app-user JWTs). */
export const API_TOKEN_PREFIX = 'shp_';
/** Characters of the token kept in plain text for display (`shp_` + 6). */
export const API_TOKEN_DISPLAY_LENGTH = 10;

/** Rate limits for unauthenticated credential endpoints. Per IP via @fastify/rate-limit route config. */
export const CREDENTIAL_RATE_LIMIT_PER_IP = { max: 20, timeWindow: 60 * 1000 } as const;
/** Per email address and client IP (logins), or per email address (reset, registration, confirmation mail). */
export const CREDENTIAL_RATE_LIMIT_PER_EMAIL = { max: 5, timeWindow: 15 * 60 * 1000 } as const;
