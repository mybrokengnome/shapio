import { i18next } from '@/app/i18n';
import en from '@/locales/en/translation.json';

/**
 * Labels for names that come from @shapio/schema at runtime (settings keys, editor IDs, option values).
 * Unknown names (e.g. a custom editor's ID) are shown as they are.
 */
const has = <T extends object>(table: T, key: string): key is Extract<keyof T, string> =>
  Object.hasOwn(table, key);

export const propertyLabel = (key: string): string =>
  has(en.models.properties, key) ? i18next.t(`models.properties.${key}`) : key;

export const valueLabel = (value: string): string =>
  has(en.models.values, value) ? i18next.t(`models.values.${value}`) : value;

export const editorLabel = (id: string): string =>
  has(en.models.editors, id) ? i18next.t(`models.editors.${id}`) : id;
