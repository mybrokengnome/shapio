import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/helpers/cn';

type PagePagerProps = {
  /** 1-based. */
  page: number;
  pageSize: number;
  total: number;
  /** Choices for the page-size select; omit to hide it. */
  pageSizes?: readonly number[];
  onPageChange: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  className?: string;
};

/** Paging for page-numbered lists with a known total: "26–50 of 112", page size, previous/next. */
export const PagePager = ({
  page,
  pageSize,
  total,
  pageSizes,
  onPageChange,
  onPageSizeChange,
  className,
}: PagePagerProps) => {
  const { t } = useTranslation();
  const pageCount = Math.max(Math.ceil(total / pageSize), 1);
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  return (
    <nav
      aria-label={t('common.pagination')}
      className={cn('flex flex-wrap items-center justify-between gap-3 text-sm', className)}
    >
      <p className="text-muted-foreground tabular-nums" aria-live="polite">
        {t('common.pageRange', { from, to, total })}
      </p>
      <div className="flex items-center gap-2">
        {pageSizes && onPageSizeChange ? (
          <Select value={String(pageSize)} onValueChange={(value) => onPageSizeChange(Number(value))}>
            <SelectTrigger size="sm" className="h-8 w-32" aria-label={t('common.rowsPerPage')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {pageSizes.map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {t('common.perPage', { count: size })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        <Button
          variant="outline"
          size="icon-sm"
          aria-label={t('common.previous')}
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeft aria-hidden="true" />
        </Button>
        <Button
          variant="outline"
          size="icon-sm"
          aria-label={t('common.next')}
          disabled={page >= pageCount}
          onClick={() => onPageChange(page + 1)}
        >
          <ChevronRight aria-hidden="true" />
        </Button>
      </div>
    </nav>
  );
};
