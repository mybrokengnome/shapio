/** Up to two initials for an avatar: "Ada Lovelace" → "AL", "ada@example.com" → "A". */
export const initialsOf = (name: string): string => {
  const words = name
    .replace(/@.*$/, '')
    .split(/[\s._-]+/)
    .filter(Boolean);
  const initials =
    words.length > 1 ? `${words[0]?.[0] ?? ''}${words.at(-1)?.[0] ?? ''}` : (words[0]?.[0] ?? '?');
  return initials.toUpperCase();
};
