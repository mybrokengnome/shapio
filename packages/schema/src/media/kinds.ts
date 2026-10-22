import type { MEDIA_KINDS } from '../types/settings.js';

export type MediaKind = (typeof MEDIA_KINDS)[number];

/**
 * How a MIME type maps to a media kind: a media field's `allowedKinds`, the admin picker and the media list's
 * `kind` filter all use these rules, the server's SQL filter included. `image/`, `video/` and `audio/` are their
 * own kinds; `text/`, a `pdf` subtype or a subtype containing one of the document words is a document; anything
 * else is `other`. Compared in lower case.
 */
export const MEDIA_KIND_TYPES = ['image', 'video', 'audio'] as const;
export const DOCUMENT_MIME_TYPE = 'text';
export const DOCUMENT_MIME_SUBTYPE = 'pdf';
export const DOCUMENT_MIME_SUBTYPE_WORDS = [
  'msword',
  'officedocument',
  'opendocument',
  'rtf',
  'epub',
] as const;

const isOwnKindType = (type: string): type is (typeof MEDIA_KIND_TYPES)[number] =>
  (MEDIA_KIND_TYPES as readonly string[]).includes(type);

/** The media kind of a MIME type, case-insensitive. */
export const mediaKindOf = (mimeType: string): MediaKind => {
  const [type = '', subtype = ''] = mimeType.trim().toLowerCase().split('/');
  if (isOwnKindType(type)) {
    return type;
  }
  if (
    type === DOCUMENT_MIME_TYPE ||
    subtype === DOCUMENT_MIME_SUBTYPE ||
    DOCUMENT_MIME_SUBTYPE_WORDS.some((word) => subtype.includes(word))
  ) {
    return 'document';
  }
  return 'other';
};
