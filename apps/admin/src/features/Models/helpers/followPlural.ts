import { suggestPlural } from '@shapio/schema';

/**
 * The plural API ID after the singular changes from `previousApiKey` to `nextApiKey`: it follows the
 * singular (`suggestPlural`) while it is empty or still the plural suggested for the previous singular,
 * and is kept once the user has typed one of their own.
 */
export const followPlural = (
  previousApiKey: string,
  nextApiKey: string,
  currentPlural: string | undefined,
): string => {
  const followsSingular =
    currentPlural === undefined || currentPlural === '' || currentPlural === suggestPlural(previousApiKey);
  return followsSingular ? suggestPlural(nextApiKey) : currentPlural;
};
