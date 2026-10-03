import { shapioAttr } from '@shapio/visual';
import { authorOf } from '../../lib/articles';
import type { Strings } from '../../lib/site';
import type { Article } from '../../lib/types';
import { Byline } from '../Byline';
import { ResponsiveImage } from '../ResponsiveImage';
import { RichText } from '../RichText';

type ArticleViewProps = { article: Article; locale: string; strings: Strings };

export const ArticleView = ({ article, locale, strings }: ArticleViewProps) => {
  const author = authorOf(article);
  return (
    <article className="article" lang={article.locale}>
      <header>
        <h1 {...shapioAttr(article, 'title')}>{article.title}</h1>
        <Byline article={article} locale={locale} strings={strings} />
      </header>
      {article.cover ? (
        <ResponsiveImage
          media={article.cover}
          sizes="(min-width: 48rem) 48rem, 100vw"
          eager
          className="cover"
          visual={shapioAttr(article, 'cover')}
        />
      ) : null}
      <RichText value={article.body} visual={shapioAttr(article, 'body')} />
      {author ? (
        <aside className="author">
          {author.avatar ? <ResponsiveImage media={author.avatar} sizes="4rem" className="avatar" /> : null}
          <div>
            <p className="author-name">{author.name}</p>
            {author.bio ? <p>{author.bio}</p> : null}
          </div>
        </aside>
      ) : null}
    </article>
  );
};
