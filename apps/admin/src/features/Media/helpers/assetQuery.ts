import type { MediaAssetQuery } from '@shapio/client';
import { ASSET_QUERY_BY_TYPE, type MediaTypeFilter } from '../constants';

type AssetTypeQuery = Pick<MediaAssetQuery, 'kind' | 'mimeType'>;

/** The type part of an asset query: a forced filter (the picker's allowed kind) wins over the chosen type. */
export const assetTypeQuery = (type: MediaTypeFilter | undefined, forced?: AssetTypeQuery): AssetTypeQuery =>
  forced ?? (type ? ASSET_QUERY_BY_TYPE[type] : {});
