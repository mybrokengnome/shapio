import { LOCALE_CODE_PATTERN, LocaleInputSchema, MAX_FALLBACK_CHAIN } from '@shapio/schema';
import { Type } from 'typebox';

const LocaleSchema = Type.Object({
  code: Type.String(),
  label: Type.String(),
  isDefault: Type.Boolean(),
  fallbacks: Type.Array(Type.String()),
});
const CodeParams = Type.Object({ code: Type.String({ pattern: LOCALE_CODE_PATTERN.source, maxLength: 35 }) });

export const listLocalesSchema = { response: { 200: Type.Object({ items: Type.Array(LocaleSchema) }) } };

export const createLocaleSchema = { body: LocaleInputSchema, response: { 201: LocaleSchema } };

export const updateLocaleSchema = {
  params: CodeParams,
  body: Type.Object(
    {
      label: Type.String({ minLength: 1, maxLength: 100 }),
      fallbacks: Type.Optional(Type.Array(Type.String(), { maxItems: MAX_FALLBACK_CHAIN })),
    },
    { additionalProperties: false },
  ),
  response: { 200: LocaleSchema },
};

export const setDefaultLocaleSchema = {
  params: CodeParams,
  body: Type.Object({ acknowledgeBreaking: Type.Optional(Type.Boolean()) }, { additionalProperties: false }),
  response: { 200: Type.Object({ code: Type.String(), changed: Type.Boolean() }) },
};

export const deleteLocaleSchema = {
  params: CodeParams,
  querystring: Type.Object(
    { acknowledgeDestructive: Type.Optional(Type.Boolean()) },
    { additionalProperties: false },
  ),
  response: { 200: Type.Object({ code: Type.String(), affectedHeads: Type.Integer() }) },
};
