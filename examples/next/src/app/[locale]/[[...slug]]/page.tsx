import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Sections } from '../../../components/Sections';
import { listPages } from '../../../lib/shapio';
import { HOME_SLUG, toLocale, type Locale } from '../../../lib/site';

/**
 * Pages from the `page` collection; `home` is the locale's front page (`/en/`), the others `/en/<slug>/`.
 * Slugs published after the build render on their first request (and are cached); unknown slugs are a 404.
 */
export const dynamicParams = true;

export const generateStaticParams = async ({ params }: { params: { locale: string } }) =>
  (await listPages(toLocale(params.locale))).map((page) => ({
    slug: page.slug === HOME_SLUG ? [] : [page.slug],
  }));

type PageParams = { params: Promise<{ locale: string; slug?: string[] }> };

const findPage = async (locale: Locale, slug: string[] | undefined) => {
  const wanted = slug?.join('/') ?? HOME_SLUG;
  return (await listPages(locale)).find((page) => page.slug === wanted);
};

export const generateMetadata = async ({ params }: PageParams): Promise<Metadata> => {
  const { locale, slug } = await params;
  const page = await findPage(toLocale(locale), slug);
  return page ? { title: page.title, description: page.description ?? undefined } : {};
};

const ContentPage = async ({ params }: PageParams) => {
  const { locale, slug } = await params;
  const page = await findPage(toLocale(locale), slug);
  if (!page) {
    notFound();
  }
  return <Sections page={page} />;
};

export default ContentPage;
