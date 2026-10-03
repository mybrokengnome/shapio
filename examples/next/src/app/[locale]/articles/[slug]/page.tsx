import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ArticleView } from '../../../../components/ArticleView';
import { listArticles } from '../../../../lib/shapio';
import { stringsFor, toLocale, type Locale } from '../../../../lib/site';

/** Published articles only: a draft has no route, so its URL is a 404. */
export const dynamicParams = false;

export const generateStaticParams = async ({ params }: { params: { locale: string } }) =>
  (await listArticles(toLocale(params.locale))).map((article) => ({ slug: article.slug }));

type ArticleParams = { params: Promise<{ locale: string; slug: string }> };

const findArticle = async (locale: Locale, slug: string) =>
  (await listArticles(locale)).find((article) => article.slug === slug);

export const generateMetadata = async ({ params }: ArticleParams): Promise<Metadata> => {
  const { locale, slug } = await params;
  const article = await findArticle(toLocale(locale), slug);
  return article ? { title: article.title, description: article.excerpt ?? undefined } : {};
};

const ArticlePage = async ({ params }: ArticleParams) => {
  const { locale: segment, slug } = await params;
  const locale = toLocale(segment);
  const article = await findArticle(locale, slug);
  if (!article) {
    notFound();
  }
  return <ArticleView article={article} locale={locale} strings={stringsFor(locale)} />;
};

export default ArticlePage;
