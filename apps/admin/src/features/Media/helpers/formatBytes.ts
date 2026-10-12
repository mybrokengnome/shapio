import { i18next } from '@/app/i18n';

const UNITS = ['byte', 'kilobyte', 'megabyte', 'gigabyte'] as const;

/**
 * `1536` → `1.5 kB`, in the admin's language. Under a kilobyte the unit is spelled out (`44 bytes`,
 * `1 byte`): the short form of `byte` is not plural in English ("44 byte").
 */
export const formatBytes = (bytes: number): string => {
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < UNITS.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return new Intl.NumberFormat(i18next.language, {
    style: 'unit',
    unit: UNITS[unit],
    unitDisplay: unit === 0 ? 'long' : 'short',
    maximumFractionDigits: unit === 0 ? 0 : 1,
  }).format(value);
};
