/** Lower case without accents, so "cafe" finds "Café". */
const normalize = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

const isWordStart = (text: string, index: number) =>
  index === 0 || !/[\p{L}\p{N}]/u.test(text[index - 1] ?? '');

/** Score of one query token against one text: a subsequence match, rewarding word starts and runs. */
const scoreToken = (token: string, text: string): number | null => {
  const substring = text.indexOf(token);
  if (substring !== -1) {
    return 10 + token.length * 2 + (isWordStart(text, substring) ? 5 : 0) + (substring === 0 ? 3 : 0);
  }
  let score = 0;
  let from = 0;
  let previous = -2;
  for (const char of token) {
    const index = text.indexOf(char, from);
    if (index === -1) {
      return null;
    }
    score +=
      1 +
      (index === previous + 1 ? 2 : 0) +
      (isWordStart(text, index) ? 3 : 0) -
      Math.min(index - from, 3) * 0.5;
    previous = index;
    from = index + 1;
  }
  return score;
};

/**
 * How well `query` finds an item with this label (and keywords): null when it doesn't, higher is better.
 * Every word of the query must match the label or a keyword; the label counts a little more.
 */
export const fuzzyScore = (query: string, label: string, keywords: readonly string[] = []): number | null => {
  const tokens = normalize(query).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return 0;
  }
  const texts = [normalize(label), ...keywords.map(normalize)];
  let total = 0;
  for (const token of tokens) {
    const scores = texts.flatMap((text, index) => {
      const score = scoreToken(token, text);
      return score === null ? [] : [index === 0 ? score * 1.2 : score];
    });
    if (scores.length === 0) {
      return null;
    }
    total += Math.max(...scores);
  }
  return total;
};

/** The items `query` finds, best first (stable for equal scores); all of them for an empty query. */
export const fuzzyFilter = <T extends { label: string; keywords?: readonly string[] }>(
  query: string,
  items: readonly T[],
): T[] =>
  items
    .map((item, index) => ({ item, index, score: fuzzyScore(query, item.label, item.keywords) }))
    .filter((entry): entry is { item: T; index: number; score: number } => entry.score !== null)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ item }) => item);
