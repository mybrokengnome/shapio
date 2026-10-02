import { checkApiKeySyntax, foldApiKey } from '@shapio/schema';
import { z } from 'zod';
import type { ValidationMessageKey } from '@/helpers/validation';

const API_KEY_MESSAGES: Readonly<Record<string, ValidationMessageKey>> = {
  API_KEY_INVALID: 'validation.apiKeyInvalid',
  API_KEY_TOO_LONG: 'validation.apiKeyTooLong',
  API_KEY_RESERVED_PREFIX: 'validation.apiKeyReservedPrefix',
};

/** The message for an API key's syntax problem (`checkApiKeySyntax`), or null when it is valid. */
const syntaxMessage = (value: string): ValidationMessageKey | null => {
  const problem = checkApiKeySyntax(value);
  return problem ? (API_KEY_MESSAGES[problem.code] ?? 'validation.apiKeyInvalid') : null;
};

/** An API key: GraphQL-name syntax, checked by @shapio/schema's own `checkApiKeySyntax`. */
export const apiKeyField = () =>
  z
    .string()
    .trim()
    .min(1, 'validation.required')
    .superRefine((value, context) => {
      const message = syntaxMessage(value);
      if (message) {
        context.addIssue({ code: 'custom', message });
      }
    });

/**
 * What is wrong with a collection's plural API ID, or null: required, API-key syntax, not the singular.
 * Nothing while the singular itself is invalid (same rule as the server's validator).
 */
export const pluralApiKeyMessage = (apiKey: string, plural: string): ValidationMessageKey | null => {
  // A plural derived from an invalid API ID is invalid too; the API ID's own message says it once.
  if (syntaxMessage(apiKey)) {
    return null;
  }
  if (plural === '') {
    return 'validation.required';
  }
  if (foldApiKey(plural) === foldApiKey(apiKey)) {
    return 'validation.pluralApiKeySameAsSingular';
  }
  return syntaxMessage(plural);
};
