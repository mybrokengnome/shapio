import type { MediaAsset } from '@shapio/client';
import { isRecord } from '@/fields/helpers/values';

/** A cover field's value in an admin list row: the asset view, or undefined when empty or not readable. */
export const coverAssetOf = (value: unknown): MediaAsset | undefined =>
  isRecord(value) &&
  typeof value.id === 'string' &&
  typeof value.mimeType === 'string' &&
  Array.isArray(value.variants)
    ? (value as MediaAsset)
    : undefined;
