/**
 * `datetime` values are canonical UTC ISO-8601 text (`2026-10-01T08:00:00.000Z`, ADR 0001). The browser's
 * `datetime-local` input works in wall-clock time without a zone, so values are converted both ways, in the
 * viewer's time zone (default) or in UTC (`display: 'utc'`).
 */
const pad = (value: number, length = 2) => String(value).padStart(length, '0');

export const toDateTimeInput = (iso: unknown, utc: boolean): string => {
  if (typeof iso !== 'string') {
    return '';
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const parts = utc
    ? [
        date.getUTCFullYear(),
        date.getUTCMonth() + 1,
        date.getUTCDate(),
        date.getUTCHours(),
        date.getUTCMinutes(),
        date.getUTCSeconds(),
      ]
    : [
        date.getFullYear(),
        date.getMonth() + 1,
        date.getDate(),
        date.getHours(),
        date.getMinutes(),
        date.getSeconds(),
      ];
  const [year = 0, month = 1, day = 1, hours = 0, minutes = 0, seconds = 0] = parts;
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}T${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
};

/** `2026-10-01T10:00` or `…T10:00:30` → canonical UTC text; null for empty or unreadable input. */
export const fromDateTimeInput = (text: string, utc: boolean): string | null => {
  if (text === '') {
    return null;
  }
  const withSeconds = /T\d{2}:\d{2}$/.test(text) ? `${text}:00` : text;
  const date = new Date(utc ? `${withSeconds}Z` : withSeconds);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

/** The viewer's IANA time zone, for the hint under local-time inputs. */
export const localTimeZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;
