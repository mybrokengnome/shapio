import type { Metadata } from 'next';
import { ArticleCard } from '../../../components/ArticleCard';
import { listArticles } from '../../../lib/shapio';
import { stringsFor, toLocale } from '../../../lib/site';

type ArticlesParams = { params: Promise<{ locale: string }> };

export const generateMetadata = async ({ params }: ArticlesParams): Promise<Metadata> => ({
  title: stringsFor(toLocale((await params).locale)).articles,
});

const ArticlesPage = async ({ params }: ArticlesParams) => {
  const locale = toLocale((await params).locale);
  const strings = stringsFor(locale);
  const articles = await listArticles(locale);
  return (
    <>
      <h1 className="page-title">{strings.articles}</h1>
      <ul className="cards">
        {articles.map((article) => (
          <ArticleCard key={article.id} article={article} locale={locale} strings={strings} />
        ))}
      </ul>
    </>
  );
};

export default ArticlesPage;
