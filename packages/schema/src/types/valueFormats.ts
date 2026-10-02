/**
 * Canonical text formats for values stored as JSON strings (ADR 0001: dates and times are canonical UTC
 * ISO-8601 text so they index and sort as text; decimal and biginteger are strings so no precision is lost).
 * The content validator (package E) and the settings validators here share these patterns.
 */
export const DATE_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
export const DATETIME_PATTERN =
  /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(\.\d{3})?Z$/;
export const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d(\.\d{3})?)?$/;
export const DECIMAL_PATTERN = /^-?(0|[1-9]\d*)(\.\d+)?$/;
export const BIGINTEGER_PATTERN = /^-?(0|[1-9]\d*)$/;
/** Lower-case words joined by single hyphens, e.g. `summer-sale-2026`. */
export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
/** URL-safe identifier characters for `uid` fields. */
export const UID_PATTERN = /^[A-Za-z0-9_.~-]+$/;

/** The rich-text document envelope version this release reads and writes (ADR 0003). */
export const RICHTEXT_FORMAT = 'shapio-richtext';
export const RICHTEXT_FORMAT_VERSION = 1;
