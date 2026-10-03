import { authorOf } from '../../lib/articles';
import { formatDate, type Strings } from '../../lib/site';
import type { Article } from '../../lib/types';

type BylineProps = { article: Article; locale: string; strings: Strings };

export const Byline = ({ article, locale, strings }: BylineProps) => {
  const author = authorOf(article);
  return (
    <p className="byline">
      {author ? `${strings.by} ${author.name} · ` : null}
      <time dateTime={article.publishedOn}>{formatDate(article.publishedOn, locale)}</time>
    </p>
  );
};
