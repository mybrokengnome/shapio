import Link from 'next/link';
import { articlePath, type Strings } from '../../lib/site';
import type { Article } from '../../lib/types';
import { Byline } from '../Byline';
import { ResponsiveImage } from '../ResponsiveImage';

type ArticleCardProps = { article: Article; locale: string; strings: Strings };

export const ArticleCard = ({ article, locale, strings }: ArticleCardProps) => (
  <li className="card">
    {article.cover ? <ResponsiveImage media={article.cover} sizes="(min-width: 48rem) 33vw, 100vw" /> : null}
    <h2>
      <Link href={articlePath(locale, article.slug)}>{article.title}</Link>
    </h2>
    <Byline article={article} locale={locale} strings={strings} />
    {article.excerpt ? <p>{article.excerpt}</p> : null}
  </li>
);
