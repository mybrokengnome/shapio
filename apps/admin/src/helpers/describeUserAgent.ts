const BROWSERS: readonly [RegExp, string][] = [
  [/Edg\//, 'Edge'],
  [/OPR\//, 'Opera'],
  [/Firefox\//, 'Firefox'],
  [/Chrome\//, 'Chrome'],
  [/Safari\//, 'Safari'],
];

const SYSTEMS: readonly [RegExp, string][] = [
  [/iPhone|iPad/, 'iOS'],
  [/Android/, 'Android'],
  [/Mac OS X|Macintosh/, 'macOS'],
  [/Windows/, 'Windows'],
  [/Linux/, 'Linux'],
];

const firstMatch = (value: string, table: readonly [RegExp, string][]) =>
  table.find(([pattern]) => pattern.test(value))?.[1];

/**
 * "Chrome on macOS" from a user-agent string (product names are not translated). `undefined` when nothing
 * is recognised, so the caller can show its own "unknown device" label.
 */
export const describeUserAgent = (userAgent: string | null): string | undefined => {
  if (!userAgent) {
    return undefined;
  }
  const browser = firstMatch(userAgent, BROWSERS);
  const system = firstMatch(userAgent, SYSTEMS);
  if (browser && system) {
    return `${browser} · ${system}`;
  }
  return browser ?? system;
};
