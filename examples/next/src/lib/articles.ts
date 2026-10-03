import type { Article, Author } from './types';

/** The populated author (`populate=author`); null when only the ID came back or the author is unpublished. */
export const authorOf = (article: Article): Author | null =>
  typeof article.author === 'object' && article.author !== null ? article.author : null;
