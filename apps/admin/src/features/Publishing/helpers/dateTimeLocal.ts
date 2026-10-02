import { z } from 'zod';

const pad = (value: number) => String(value).padStart(2, '0');

const DATE_TIME_LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

const HOUR_MS = 60 * 60 * 1000;

/** `YYYY-MM-DDTHH:mm` in the browser's time zone: the value format of `<input type="datetime-local">`. */
export const toDateTimeLocalValue = (date: Date): string =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;

/**
 * The instant a `datetime-local` value means (read in the browser's time zone) as an ISO string for the
 * API, or `undefined` when the value is not a real date and time (e.g. 31 February).
 */
export const dateTimeLocalToIso = (value: string): string | undefined => {
  const match = DATE_TIME_LOCAL.exec(value);
  if (!match) {
    return undefined;
  }
  // Seconds are optional in the value; a missing group reads as 0.
  const [year = 0, month = 0, day = 0, hours = 0, minutes = 0, seconds = 0] = match
    .slice(1)
    .map((part) => (part === undefined ? 0 : Number(part)));
  const date = new Date(year, month - 1, day, hours, minutes, seconds);
  const roundTrips =
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day &&
    date.getHours() === hours &&
    date.getMinutes() === minutes;
  return roundTrips ? date.toISOString() : undefined;
};

/** The default time offered for a new schedule: the start of the next hour, at least 30 minutes away. */
export const defaultScheduleValue = (now: Date = new Date()): string => {
  const next = new Date(now.getTime() + HOUR_MS / 2);
  next.setMinutes(0, 0, 0);
  return toDateTimeLocalValue(new Date(next.getTime() + HOUR_MS));
};

/** A form field holding a `datetime-local` value that must be a real date and time. */
export const dateTimeLocalField = () =>
  z.string().refine((value) => dateTimeLocalToIso(value) !== undefined, 'validation.dateTime');
