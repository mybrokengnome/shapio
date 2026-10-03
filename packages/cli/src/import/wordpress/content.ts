import { posix } from 'node:path';
import type { ConversionWarning } from '../types.js';
import { autop } from './autop.js';

/**
 * Post bodies: shortcodes WordPress would expand, paragraph tags it would add, and matching the images a post
 * shows to the media items that were imported (by URL, including the resized copies WordPress generates).
 */

const CAPTION = /\[caption[^\]]*\]([\s\S]*?)\[\/caption\]/gi;
const CAPTION_MEDIA = /^\s*((?:<a\b[^>]*>\s*)?<img\b[^>]*>(?:\s*<\/a>)?)([\s\S]*)$/i;
const SHORTCODE_CLOSE = /\[\/([a-z][a-z0-9_-]*)\]/gi;
const KNOWN_SHORTCODES = /\[(gallery|embed|video|audio|playlist|contact-form-7|contact-form)\b[^\]]*\]/gi;

/** `[caption]<img> text[/caption]` → `<figure><img><figcaption>text</figcaption></figure>`. */
export const expandCaptions = (html: string): string =>
  html.replace(CAPTION, (match, inner: string) => {
    const parts = CAPTION_MEDIA.exec(inner);
    if (!parts) {
      return inner;
    }
    const caption = (parts[2] ?? '').trim();
    return `<figure>${parts[1] ?? ''}${caption ? `<figcaption>${caption}</figcaption>` : ''}</figure>`;
  });

/** Shortcodes left in the text after captions were expanded (they show up as literal text). */
export const shortcodeWarnings = (html: string): ConversionWarning[] => {
  const names = new Set<string>();
  for (const match of html.matchAll(SHORTCODE_CLOSE)) {
    names.add(match[1]!.toLowerCase());
  }
  for (const match of html.matchAll(KNOWN_SHORTCODES)) {
    names.add(match[1]!.toLowerCase());
  }
  return [...names].map((name) => ({ code: 'shortcodeKept', detail: `[${name}]` }));
};

/** A post body ready for the HTML converter. */
export const prepareBody = (content: string): string => autop(expandCaptions(content));

/** Absolute URL of an image `src` (relative ones against the site), or undefined for data: and the like. */
export const absoluteUrl = (src: string, base: string): string | undefined => {
  try {
    const url = new URL(src, base || undefined);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined;
  } catch {
    return undefined;
  }
};

const SIZE_SUFFIX = /-(\d+x\d+|scaled)(\.[a-z0-9]+)$/i;

/** Scheme-, query- and size-insensitive key: `//host/wp-content/uploads/a-300x200.jpg` → `host/…/a.jpg`. */
const urlKey = (url: string, stripSize: boolean): string | undefined => {
  try {
    const parsed = new URL(url);
    const path = decodeURIComponent(parsed.pathname);
    return `${parsed.host.toLowerCase()}${stripSize ? path.replace(SIZE_SUFFIX, '$2') : path}`;
  } catch {
    return undefined;
  }
};

export type ImageIndex = {
  /** The media source ID an image URL shows, if it was imported. */
  lookup: (src: string) => string | undefined;
  add: (url: string, sourceId: string) => void;
};

export const createImageIndex = (base: string): ImageIndex => {
  const exact = new Map<string, string>();
  const sized = new Map<string, string>();
  return {
    add: (url, sourceId) => {
      const key = urlKey(url, false);
      const stripped = urlKey(url, true);
      if (key && !exact.has(key)) {
        exact.set(key, sourceId);
      }
      if (stripped && !sized.has(stripped)) {
        sized.set(stripped, sourceId);
      }
    },
    lookup: (src) => {
      const url = absoluteUrl(src, base);
      if (!url) {
        return undefined;
      }
      const key = urlKey(url, false);
      const stripped = urlKey(url, true);
      return (key && exact.get(key)) ?? (stripped && sized.get(stripped)) ?? undefined;
    },
  };
};

/** The file name a URL ends with (decoded), for the media library. */
export const filenameOf = (url: string, fallback: string): string => {
  try {
    const name = posix.basename(decodeURIComponent(new URL(url).pathname));
    return name || fallback;
  } catch {
    return fallback;
  }
};

/** Where `--media-dir` (a copy of `wp-content/uploads`) holds the file of an uploads URL. */
export const uploadsRelativePath = (url: string): string | undefined => {
  try {
    const path = decodeURIComponent(new URL(url).pathname);
    const index = path.indexOf('/uploads/');
    return index >= 0 ? path.slice(index + '/uploads/'.length) : undefined;
  } catch {
    return undefined;
  }
};
