import type { UseQueryResult } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ErrorState } from '../ErrorState';
import { LoadingState } from '../LoadingState';

type QueryViewProps<TData> = {
  query: UseQueryResult<TData>;
  /** Rendered instead of `children` when `isEmpty` says the data has nothing to show. */
  empty?: ReactNode;
  isEmpty?: (data: TData) => boolean;
  loadingRows?: number;
  children: (data: TData) => ReactNode;
};

/** Loading, error (with retry), empty and loaded states for one query, so every screen handles all four. */
export const QueryView = <TData,>({
  query,
  empty,
  isEmpty,
  loadingRows,
  children,
}: QueryViewProps<TData>) => {
  if (query.isPending) {
    return <LoadingState rows={loadingRows} />;
  }
  if (query.isError) {
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  }
  if (empty !== undefined && isEmpty?.(query.data)) {
    return empty;
  }
  return children(query.data);
};
