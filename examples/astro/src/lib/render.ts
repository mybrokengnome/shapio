import { shapioAttr, type EntryRef } from '@shapio/visual';
import { articlePath, formatDate, type Strings } from './site.js';
import type { Article, Author, Media, Section } from './types.js';

/**
 * HTML for the site's content, as plain functions: the static pages render with them at build time and the
 * preview page renders drafts with the same functions in the browser, so a preview looks exactly like the
 * published page. Every string from the CMS is escaped; rich text arrives as Shapio's sanitised `html`.
 */
export type RenderContext = { locale: string; strings: Strings };

const ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);

/** Links from content: web, mail, phone and site-relative only (a `javascript:` URL renders as `#`). */
export const safeHref = (value: string | null | undefined): string => {
  const href = (value ?? '').trim();
  return /^(https?:\/\/|mailto:|tel:|\/(?!\/)|#)/i.test(href) ? escapeHtml(href) : '#';
};

/**
 * `shapioAttr` as an HTML attribute string: the field an element shows, so Shapio's preview can take a click on
 * it back to that field (@shapio/visual). Harmless on published pages (entry IDs and API IDs only).
 */
export const visualAttributes = (entry: EntryRef, path: string): string =>
  Object.entries(shapioAttr(entry, path))
    .map(([name, value]) => ` ${name}="${escapeHtml(value)}"`)
    .join('');

const paragraph = (text: string | null | undefined, className = '') =>
  text ? `<p${className ? ` class="${className}"` : ''}>${escapeHtml(text)}</p>` : '';

type ImageOptions = { sizes: string; eager?: boolean; className?: string; attributes?: string };

/** A responsive `<img>`: WebP variants in `srcset`, intrinsic size set (no layout shift), lazy unless eager. */
export const responsiveImage = (
  media: Media,
  { sizes, eager = false, className, attributes: extra = '' }: ImageOptions,
): string => {
  const widths = media.variants
    .filter((variant) => variant.name.startsWith('w') && variant.width !== null)
    .sort((a, b) => (a.width ?? 0) - (b.width ?? 0));
  const largest = widths.at(-1);
  const srcset = widths.map((variant) => `${variant.url} ${variant.width}w`);
  const attributes = [
    `src="${escapeHtml(largest?.url ?? media.url)}"`,
    srcset.length > 0 ? `srcset="${escapeHtml(srcset.join(', '))}" sizes="${escapeHtml(sizes)}"` : '',
    media.width && media.height ? `width="${media.width}" height="${media.height}"` : '',
    `alt="${escapeHtml(media.alt)}"`,
    eager ? 'loading="eager" fetchpriority="high"' : 'loading="lazy"',
    'decoding="async"',
    className ? `class="${className}"` : '',
  ];
  return `<img ${attributes.filter(Boolean).join(' ')}${extra}>`;
};

const renderSection = (section: Section, index: number, entry: EntryRef): string => {
  switch (section.__component) {
    case 'hero': {
      const heading = index === 0 ? 'h1' : 'h2';
      return `<section class="hero">
  <div class="hero-text">
    <${heading}${visualAttributes(entry, `sections/${index}/heading`)}>${escapeHtml(section.heading)}</${heading}>
    ${paragraph(section.subheading, 'lead')}
    ${section.ctaLabel && section.ctaUrl ? `<a class="button" href="${safeHref(section.ctaUrl)}">${escapeHtml(section.ctaLabel)}</a>` : ''}
  </div>
  ${section.image ? responsiveImage(section.image, { sizes: '(min-width: 64rem) 50vw, 100vw', eager: index === 0, className: 'hero-image' }) : ''}
</section>`;
    }
    case 'featureGrid':
      return `<section class="features">
  ${section.heading ? `<h2>${escapeHtml(section.heading)}</h2>` : ''}
  <ul class="feature-grid">${section.features
    .map((feature) => `<li><h3>${escapeHtml(feature.title)}</h3>${paragraph(feature.description)}</li>`)
    .join('')}</ul>
</section>`;
    case 'gallery':
      return `<section class="gallery">
  ${section.heading ? `<h2>${escapeHtml(section.heading)}</h2>` : ''}
  <ul class="gallery-grid">${section.images
    .map(
      (image) =>
        `<li><figure>${responsiveImage(image, { sizes: '(min-width: 48rem) 33vw, 100vw' })}${image.caption ? `<figcaption>${escapeHtml(image.caption)}</figcaption>` : ''}</figure></li>`,
    )
    .join('')}</ul>
</section>`;
    case 'callToAction':
      return `<section class="cta">
  <h2>${escapeHtml(section.heading)}</h2>
  ${paragraph(section.text)}
  <a class="button" href="${safeHref(section.buttonUrl)}">${escapeHtml(section.buttonLabel)}</a>
</section>`;
    default:
      // A section type this site does not know yet (added in Shapio after the last site deploy): skipped.
      return '';
  }
};

/** A page's dynamic zone. The page title is the heading when the page does not open with a hero. */
export const renderPage = (page: {
  id: string;
  locale: string;
  title: string;
  sections: Section[];
}): string => {
  const opensWithHero = page.sections[0]?.__component === 'hero';
  return `${opensWithHero ? '' : `<h1 class="page-title"${visualAttributes(page, 'title')}>${escapeHtml(page.title)}</h1>`}${page.sections
    .map((section, index) => renderSection(section, index, page))
    .join('\n')}`;
};

const authorOf = (article: Article): Author | null =>
  typeof article.author === 'object' && article.author !== null ? article.author : null;

const byline = (article: Article, context: RenderContext) => {
  const author = authorOf(article);
  return `<p class="byline">${author ? `${context.strings.by} ${escapeHtml(author.name)} · ` : ''}<time datetime="${escapeHtml(article.publishedOn)}">${formatDate(article.publishedOn, context.locale)}</time></p>`;
};

export const renderArticle = (article: Article, context: RenderContext): string => {
  const author = authorOf(article);
  return `<article class="article" lang="${escapeHtml(article.locale)}">
  <header>
    <h1${visualAttributes(article, 'title')}>${escapeHtml(article.title)}</h1>
    ${byline(article, context)}
  </header>
  ${article.cover ? responsiveImage(article.cover, { sizes: '(min-width: 48rem) 48rem, 100vw', eager: true, className: 'cover', attributes: visualAttributes(article, 'cover') }) : ''}
  <div class="prose"${visualAttributes(article, 'body')}>${article.body?.html ?? ''}</div>
  ${author ? `<aside class="author">${author.avatar ? responsiveImage(author.avatar, { sizes: '4rem', className: 'avatar' }) : ''}<div><p class="author-name">${escapeHtml(author.name)}</p>${paragraph(author.bio)}</div></aside>` : ''}
</article>`;
};

export const renderArticleCard = (article: Article, context: RenderContext): string => `<li class="card">
  ${article.cover ? responsiveImage(article.cover, { sizes: '(min-width: 48rem) 33vw, 100vw' }) : ''}
  <h2${visualAttributes(article, 'title')}><a href="${escapeHtml(articlePath(context.locale, article.slug))}">${escapeHtml(article.title)}</a></h2>
  ${byline(article, context)}
  ${paragraph(article.excerpt)}
</li>`;
