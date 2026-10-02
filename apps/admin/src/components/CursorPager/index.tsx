import { ChevronLeft, ChevronRight, ChevronsLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { cn } from '@/helpers/cn';

type CursorPagerProps = {
  /** Undefined when already on the first page. */
  onFirst: (() => void) | undefined;
  onPrevious: (() => void) | undefined;
  /** Undefined when there is no further page. */
  onNext: (() => void) | undefined;
  className?: string;
};

/** Paging for cursor-paginated lists (newest first, no total): Newest, Previous, Next as icon buttons. */
export const CursorPager = ({ onFirst, onPrevious, onNext, className }: CursorPagerProps) => {
  const { t } = useTranslation();
  return (
    <nav aria-label={t('common.pagination')} className={cn('flex items-center justify-end gap-2', className)}>
      <Button
        variant="outline"
        size="icon-sm"
        aria-label={t('common.first')}
        disabled={!onFirst}
        onClick={onFirst}
      >
        <ChevronsLeft aria-hidden="true" />
      </Button>
      <Button
        variant="outline"
        size="icon-sm"
        aria-label={t('common.previous')}
        disabled={!onPrevious}
        onClick={onPrevious}
      >
        <ChevronLeft aria-hidden="true" />
      </Button>
      <Button
        variant="outline"
        size="icon-sm"
        aria-label={t('common.next')}
        disabled={!onNext}
        onClick={onNext}
      >
        <ChevronRight aria-hidden="true" />
      </Button>
    </nav>
  );
};
