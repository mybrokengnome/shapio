import type { Metadata } from 'next';
import { RichText } from '../../../components/RichText';
import { pageMetadata } from '../../../lib/metadata';
import { getSiteSettings } from '../../../lib/shapio';
import { colophonPath, stringsFor, toLocale } from '../../../lib/site';

type ColophonParams = { params: Promise<{ locale: string }> };

export const generateMetadata = async ({ params }: ColophonParams): Promise<Metadata> => {
  const locale = toLocale((await params).locale);
  return pageMetadata({ title: stringsFor(locale).colophon, locale, path: colophonPath(locale) });
};

/** The singleton page: the siteSettings entry's colophon, one per locale. */
const ColophonPage = async ({ params }: ColophonParams) => {
  const locale = toLocale((await params).locale);
  const settings = await getSiteSettings(locale);
  return (
    <>
      <h1 className="page-title">{stringsFor(locale).colophon}</h1>
      {settings?.tagline ? <p className="lead">{settings.tagline}</p> : null}
      <RichText value={settings?.colophon ?? null} />
    </>
  );
};

export default ColophonPage;
