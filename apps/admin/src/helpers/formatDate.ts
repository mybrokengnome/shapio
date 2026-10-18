import { i18next } from '@/app/i18n';

const dateTimeFormats = new Map<string, Intl.DateTimeFormat>();

const formatterFor = (language: string, withTime: boolean) => {
  const key = `${language}|${withTime ? 'time' : 'date'}`;
  let formatter = dateTimeFormats.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(
      language,
      withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' },
    );
    dateTimeFormats.set(key, formatter);
  }
  return formatter;
};

const format = (value: string | null | undefined, withTime: boolean): string => {
  if (!value) {
    return '';
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : formatterFor(i18next.language, withTime).format(date);
};

/** Locale-aware date and time for tables; `null` and invalid input give an empty string. */
export const formatDateTime = (value: string | null | undefined): string => format(value, true);

/** Locale-aware date without the time ("Jan 16, 2027"); `null` and invalid input give an empty string. */
export const formatDate = (value: string | null | undefined): string => format(value, false);

const relativeTimeFormats = new Map<string, Intl.RelativeTimeFormat>();

const relativeFormatterFor = (language: string) => {
  let formatter = relativeTimeFormats.get(language);
  if (!formatter) {
    formatter = new Intl.RelativeTimeFormat(language, { numeric: 'auto', style: 'short' });
    relativeTimeFormats.set(language, formatter);
  }
  return formatter;
};

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

/** The largest unit that keeps the number readable ("3 hr. ago", not "180 min. ago"). */
const RELATIVE_UNITS: ReadonlyArray<[limit: number, size: number, unit: Intl.RelativeTimeFormatUnit]> = [
  [MINUTE, SECOND, 'second'],
  [HOUR, MINUTE, 'minute'],
  [DAY, HOUR, 'hour'],
  [WEEK, DAY, 'day'],
  [5 * WEEK, WEEK, 'week'],
  [YEAR, MONTH, 'month'],
  [Infinity, YEAR, 'year'],
];

type RelativeTimeOptions = { now?: number; language?: string };

/**
 * "2 hr. ago", "in 3 days", "yesterday": for list columns. Pair it with the full date (formatDateTime) in
 * a `title` or tooltip. `null` and invalid input give an empty string.
 */
export const formatRelativeTime = (
  value: string | null | undefined,
  { now = Date.now(), language = i18next.language }: RelativeTimeOptions = {},
): string => {
  if (!value) {
    return '';
  }
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) {
    return '';
  }
  const diff = time - now;
  const [, size, unit] = RELATIVE_UNITS.find(([limit]) => Math.abs(diff) < limit) ?? RELATIVE_UNITS[0]!;
  return relativeFormatterFor(language).format(Math.round(diff / size), unit);
};

/** A calendar month (`2026-10`, as usage periods are named) as "October 2026"; other input as it is. */
export const formatMonth = (month: string, language: string = i18next.language): string => {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) {
    return month;
  }
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1));
  return new Intl.DateTimeFormat(language, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date);
};
