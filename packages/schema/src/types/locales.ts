import { Type, type Static } from 'typebox';

/** BCP 47 subset: language (2–3 letters) plus optional subtags, e.g. `en`, `fr-CA`, `zh-Hant-TW`. */
export const LOCALE_CODE_PATTERN = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
export const MAX_FALLBACK_CHAIN = 10;

export const LocaleInputSchema = Type.Object(
  {
    code: Type.String({ pattern: LOCALE_CODE_PATTERN.source, maxLength: 35 }),
    label: Type.String({ minLength: 1, maxLength: 100 }),
    /** Locales tried in order when content is missing in this one; the default locale is always last. */
    fallbacks: Type.Optional(Type.Array(Type.String(), { maxItems: MAX_FALLBACK_CHAIN })),
  },
  { additionalProperties: false },
);

export type LocaleInput = Static<typeof LocaleInputSchema>;

export type LocaleDefinition = {
  code: string;
  label: string;
  isDefault: boolean;
  fallbacks: string[];
};
