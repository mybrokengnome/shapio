/**
 * "Signed in" → "signed in", so an action label reads on after the actor's name ("Ada Lovelace signed in").
 * Labels start with a verb, so only the first letter changes ("Created API token" → "created API token").
 */
export const lowerFirst = (text: string, language: string): string =>
  text.charAt(0).toLocaleLowerCase(language) + text.slice(1);
