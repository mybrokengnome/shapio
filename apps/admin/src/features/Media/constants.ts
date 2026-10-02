/** Type filter values (URL `type`) and the MIME filter each sends to the API. */
export const MEDIA_TYPE_FILTERS = ['image', 'video', 'audio', 'pdf'] as const;
export type MediaTypeFilter = (typeof MEDIA_TYPE_FILTERS)[number];

export const MIME_FILTER_BY_TYPE = {
  image: 'image/*',
  video: 'video/*',
  audio: 'audio/*',
  pdf: 'application/pdf',
} as const satisfies Record<MediaTypeFilter, string>;

export const MEDIA_VIEWS = ['grid', 'list'] as const;
export type MediaView = (typeof MEDIA_VIEWS)[number];

/** The folder filter for assets that are in no folder. */
export const ROOT_FOLDER = 'root';

/** Translation keys per variant name (the server's names; unknown ones show as-is). */
export const VARIANT_LABEL_KEYS = {
  thumbnail: 'media.variants.thumbnail',
  w640: 'media.variants.w640',
  w1280: 'media.variants.w1280',
  w1920: 'media.variants.w1920',
} as const;

export const isKnownVariant = (name: string): name is keyof typeof VARIANT_LABEL_KEYS =>
  Object.hasOwn(VARIANT_LABEL_KEYS, name);
