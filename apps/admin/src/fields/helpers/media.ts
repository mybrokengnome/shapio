import type { MediaAsset, MediaAssetQuery } from '@shapio/client';
import type { MediaKind, PickedMedia } from '@shapio/editor-sdk';

/** The media kind of a MIME type (the server's `allowedKinds` buckets). */
export const mediaKindOf = (mimeType: string): MediaKind => {
  if (mimeType.startsWith('image/')) {
    return 'image';
  }
  if (mimeType.startsWith('video/')) {
    return 'video';
  }
  if (mimeType.startsWith('audio/')) {
    return 'audio';
  }
  if (
    mimeType === 'application/pdf' ||
    mimeType.startsWith('text/') ||
    mimeType.includes('officedocument') ||
    mimeType.includes('opendocument') ||
    mimeType === 'application/msword'
  ) {
    return 'document';
  }
  return 'other';
};

/** What an editor gets back from the picker: never storage keys or attribution. */
export const toPickedMedia = (asset: MediaAsset): PickedMedia => ({
  id: asset.id,
  filename: asset.filename,
  mimeType: asset.mimeType,
  url: asset.url,
  alt: asset.alt,
  width: asset.width,
  height: asset.height,
});

/**
 * The picker's forced asset query for a set of allowed kinds (only when it is one MIME family), sent as
 * `kind`: a `type/*` pattern in a query string trips web application firewalls' SQL injection rules.
 */
export const kindFilterFor = (
  kinds: readonly MediaKind[] | undefined,
): Pick<MediaAssetQuery, 'kind'> | undefined => {
  if (kinds?.length !== 1) {
    return undefined;
  }
  const [kind] = kinds;
  return kind === 'image' || kind === 'video' || kind === 'audio' ? { kind } : undefined;
};
