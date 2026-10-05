import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { DraftsBadge } from '../../components/DraftsBadge';
import { LocaleSwitch } from '../../components/LocaleSwitch';
import { isDraftsMode } from '../../lib/config';
import { getSiteSettings } from '../../lib/shapio';
import {
  articlesPath,
  colophonPath,
  HOME_SLUG,
  isLocale,
  LOCALES,
  otherLocale,
  pagePath,
  stringsFor,
  toLocale,
} from '../../lib/site';
import '../site.css';

/**
 * Only the site's locales exist; any other first segment is a 404 (notFound below). Not `dynamicParams = false`:
 * Next answers a page that /api/revalidate marked stale with a 404 when its route allows no fallback, so every
 * route here renders on demand and rejects unknown values itself.
 */
export const dynamicParams = true;
export const generateStaticParams = () => LOCALES.map((locale) => ({ locale }));

type LocaleParams = { params: Promise<{ locale: string }> };

/**
 * The fallback title and the icon. Every page sets its own complete title (`title.absolute`, already through
 * the site's title template from Shapio's SEO defaults), so this layout applies no template of its own.
 */
export const generateMetadata = async ({ params }: LocaleParams): Promise<Metadata> => {
  const locale = toLocale((await params).locale);
  const siteName = (await getSiteSettings(locale))?.siteName ?? stringsFor(locale).siteName;
  return { title: siteName, icons: '/favicon.svg' };
};

type LocaleLayoutProps = LocaleParams & { children: ReactNode };

/** The root layout: every page lives under its locale (`/en/…`, `/fr/…`). */
const LocaleLayout = async ({ children, params }: LocaleLayoutProps) => {
  const segment = (await params).locale;
  if (!isLocale(segment)) {
    notFound();
  }
  const locale = toLocale(segment);
  const strings = stringsFor(locale);
  // The name, tagline and footer come from the siteSettings singleton (built-in strings until it is published).
  const settings = await getSiteSettings(locale);
  const other = otherLocale(locale);
  return (
    <html lang={locale}>
      <body>
        <a className="skip" href="#content">
          {strings.skipToContent}
        </a>
        <header className="site-header">
          <Link className="brand" href={pagePath(locale, HOME_SLUG)}>
            {settings?.siteName ?? strings.siteName}
          </Link>
          {settings?.tagline ? <p className="tagline">{settings.tagline}</p> : null}
          <nav aria-label="Main">
            <Link href={articlesPath(locale)}>{strings.articles}</Link>
            <Link href={colophonPath(locale)}>{strings.colophon}</Link>
            <LocaleSwitch to={other} label={strings.switchTo} />
          </nav>
        </header>
        <main id="content">{children}</main>
        <footer className="site-footer">
          <p>
            {settings?.siteName ?? strings.siteName} · {settings?.footer ?? strings.footer} · Next.js
          </p>
        </footer>
        {isDraftsMode() ? <DraftsBadge strings={strings} /> : null}
      </body>
    </html>
  );
};

export default LocaleLayout;
