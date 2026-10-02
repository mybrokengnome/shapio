import { ArrowDown, ArrowUp, ChevronRight, Copy, GripVertical, Trash2 } from 'lucide-react';
import type { DragEvent, KeyboardEvent, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { StatusChip } from '@/components/StatusChip';
import { Button } from '@/components/ui/button';
import { cn } from '@/helpers/cn';

type ItemCardProps = {
  id: string;
  title: string;
  summary: string;
  index: number;
  count: number;
  collapsed: boolean;
  issueCount: number;
  editable: boolean;
  onToggle: () => void;
  onMove?: (to: number) => void;
  onDuplicate?: () => void;
  onRemove?: () => void;
  /**
   * `canvas`: a block of the entry document: quiet chrome, actions on hover or focus, a drag grip.
   * Requires `drag` for the grip and the drop target.
   */
  appearance?: 'form' | 'canvas';
  drag?: {
    handle: { draggable: boolean; onDragStart: (event: DragEvent) => void; onDragEnd: () => void };
    target: { onDragOver: (event: DragEvent) => void; onDrop: (event: DragEvent) => void };
    dropSide: 'before' | 'after' | undefined;
  };
  children: ReactNode;
};

/**
 * One item of a repeatable component or dynamic zone: a header that collapses it (with a readable summary
 * and its problem count), move, duplicate and remove actions, and the item's fields. Alt+↑/↓ on the header
 * moves the item.
 */
export const ItemCard = ({
  id,
  title,
  summary,
  index,
  count,
  collapsed,
  issueCount,
  editable,
  onToggle,
  onMove,
  onDuplicate,
  onRemove,
  appearance = 'form',
  drag,
  children,
}: ItemCardProps) => {
  const { t } = useTranslation();
  const bodyId = `${id}-body`;
  const onKeyDown = (event: KeyboardEvent) => {
    if (!event.altKey || !onMove) {
      return;
    }
    if (event.key === 'ArrowUp' && index > 0) {
      event.preventDefault();
      onMove(index - 1);
    } else if (event.key === 'ArrowDown' && index < count - 1) {
      event.preventDefault();
      onMove(index + 1);
    }
  };
  const canvas = appearance === 'canvas';
  // On the canvas the actions appear on hover, and stay while anything in the block has focus.
  const actionClasses = canvas
    ? 'opacity-0 transition-opacity group-focus-within/item:opacity-100 group-hover/item:opacity-100'
    : undefined;
  return (
    <li
      id={id}
      className={cn(
        'group/item scroll-mt-32 rounded-xl border bg-card data-invalid:border-destructive/60',
        canvas && 'border-transparent bg-muted/40 focus-within:border-border hover:border-border',
        drag?.dropSide === 'before' && 'shadow-[0_-3px_0_0_var(--color-ring)]',
        drag?.dropSide === 'after' && 'shadow-[0_3px_0_0_var(--color-ring)]',
      )}
      data-invalid={issueCount > 0 || undefined}
      {...(canvas ? drag?.target : {})}
    >
      <div className="flex items-center gap-1 py-1.5 pr-2 pl-1.5">
        {canvas && editable && drag ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className={cn('cursor-grab text-muted-foreground active:cursor-grabbing', actionClasses)}
            aria-label={t('entry.blocks.dragItem', { item: title, position: index + 1 })}
            {...drag.handle}
          >
            <GripVertical aria-hidden="true" />
          </Button>
        ) : null}
        <button
          type="button"
          aria-expanded={!collapsed}
          aria-controls={bodyId}
          onClick={onToggle}
          onKeyDown={onKeyDown}
          className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-lg px-2 text-left outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <ChevronRight
            aria-hidden="true"
            className={cn(
              'size-4 shrink-0 text-muted-foreground transition-transform',
              !collapsed && 'rotate-90',
            )}
          />
          <span className="shrink-0 text-sm font-semibold">{title}</span>
          {summary ? (
            <span className="min-w-0 truncate text-meta text-muted-foreground">{summary}</span>
          ) : null}
          <span className="sr-only">{t('content.items.position', { index: index + 1, count })}</span>
        </button>
        {issueCount > 0 ? (
          <StatusChip tone="danger" size="sm" label={t('content.items.problems', { count: issueCount })} />
        ) : null}
        <span className={cn('flex items-center gap-1', actionClasses)}>
          {editable && onMove ? (
            <>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={t('content.items.moveUp', { item: title, position: index + 1 })}
                disabled={index === 0}
                onClick={() => onMove(index - 1)}
              >
                <ArrowUp aria-hidden="true" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={t('content.items.moveDown', { item: title, position: index + 1 })}
                disabled={index === count - 1}
                onClick={() => onMove(index + 1)}
              >
                <ArrowDown aria-hidden="true" />
              </Button>
            </>
          ) : null}
          {editable && onDuplicate ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t('content.items.duplicate', { item: title, position: index + 1 })}
              onClick={onDuplicate}
            >
              <Copy aria-hidden="true" />
            </Button>
          ) : null}
          {editable && onRemove ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t('content.items.remove', { item: title, position: index + 1 })}
              onClick={onRemove}
            >
              <Trash2 aria-hidden="true" />
            </Button>
          ) : null}
        </span>
      </div>
      <div id={bodyId} hidden={collapsed} className={cn(canvas ? 'px-4 pt-1 pb-4' : 'border-t p-5')}>
        {collapsed ? null : children}
      </div>
    </li>
  );
};
