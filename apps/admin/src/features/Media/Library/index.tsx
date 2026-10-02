import type { MediaAsset } from '@shapio/client';
import { Images } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useMediaAssets } from '@/api/media';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { LoadingState } from '@/components/LoadingState';
import { Button } from '@/components/ui/button';
import { AssetGrid } from '../AssetGrid';
import { AssetTable } from '../AssetTable';
import type { MediaView } from '../constants';

type LibraryProps = {
  query: Parameters<typeof useMediaAssets>[0];
  filtered: boolean;
  view: MediaView;
  selected: ReadonlySet<string>;
  selectable: boolean;
  activeId: string | undefined;
  onSelectChange: (id: string, checked: boolean) => void;
  onOpen: (asset: MediaAsset) => void;
};

/** The assets of the current folder and filters: loading, error, empty, grid or list, and "Load more". */
export const Library = ({
  query,
  filtered,
  view,
  selected,
  selectable,
  activeId,
  onSelectChange,
  onOpen,
}: LibraryProps) => {
  const { t } = useTranslation();
  const assets = useMediaAssets(query);
  if (assets.isPending) {
    return <LoadingState rows={4} />;
  }
  if (assets.isError) {
    return <ErrorState error={assets.error} onRetry={() => void assets.refetch()} />;
  }
  const items = assets.data.pages.flatMap((page) => page.items);
  if (items.length === 0) {
    // The whole library is empty: a page-sized empty state. An empty folder or search: a quieter one.
    const scoped = filtered || query.folder !== undefined;
    return (
      <EmptyState
        icon={Images}
        size={scoped ? 'panel' : 'page'}
        title={filtered ? t('media.emptyFiltered') : scoped ? t('media.emptyFolder') : t('media.empty')}
      />
    );
  }
  return (
    <div className="space-y-4">
      {view === 'grid' ? (
        <AssetGrid
          assets={items}
          selected={selected}
          selectable={selectable}
          activeId={activeId}
          onSelectChange={onSelectChange}
          onOpen={onOpen}
        />
      ) : (
        <AssetTable
          assets={items}
          selected={selected}
          selectable={selectable}
          onSelectChange={onSelectChange}
          onOpen={onOpen}
        />
      )}
      {assets.hasNextPage ? (
        <div className="flex justify-center">
          <Button
            variant="outline"
            disabled={assets.isFetchingNextPage}
            aria-busy={assets.isFetchingNextPage || undefined}
            onClick={() => void assets.fetchNextPage()}
          >
            {assets.isFetchingNextPage ? t('common.loading') : t('media.loadMore')}
          </Button>
        </div>
      ) : null}
    </div>
  );
};
