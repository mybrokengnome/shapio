const PROBE_ORIGIN = 'http://shapio.invalid';

// Browsers drop tabs and line breaks from URLs, so `/\t/evil.test` would become `//evil.test`.
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

/**
 * Only same-app paths are accepted as a post-login destination: `/settings` yes, `//evil.test`,
 * `https://evil.test` or `/\t/evil.test` no (open redirect). The path must resolve on the current origin.
 */
export const safeRedirectPath = (value: unknown): string => {
  if (
    typeof value !== 'string' ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('\\') ||
    CONTROL_CHARACTERS.test(value)
  ) {
    return '/';
  }
  return new URL(value, PROBE_ORIGIN).origin === PROBE_ORIGIN ? value : '/';
};
