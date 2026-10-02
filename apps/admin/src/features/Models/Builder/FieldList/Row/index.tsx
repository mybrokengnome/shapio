import type { FieldDefinition } from '@shapio/schema';
import { AlertCircle, ChevronDown, ChevronUp, EyeOff, GripVertical } from 'lucide-react';
import type { DragEvent, KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/helpers/cn';
import { DATA_TYPE_ICONS } from '../../../constants';
import { handleIdOf } from '../handleId';

type RowProps = {
  field: FieldDefinition;
  index: number;
  total: number;
  selected: boolean;
  hasIssues: boolean;
  showLocalized: boolean;
  dropTarget: boolean;
  disabled: boolean;
  onSelect: () => void;
  onMove: (to: number) => void;
  onDragStart: (event: DragEvent) => void;
  onDragOver: (event: DragEvent) => void;
  onDrop: (event: DragEvent) => void;
  onDragEnd: () => void;
};

/**
 * One field in the builder's list (44px): drag, the arrow keys on the handle, or the chevrons shown on
 * hover reorder it; click to edit. The chevrons are for the mouse (the handle already moves with the
 * keyboard), so they are not extra Tab stops.
 */
export const Row = ({
  field,
  index,
  total,
  selected,
  hasIssues,
  showLocalized,
  dropTarget,
  disabled,
  onSelect,
  onMove,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: RowProps) => {
  const { t } = useTranslation();
  const Icon = DATA_TYPE_ICONS[field.type];
  const onHandleKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'ArrowUp' && index > 0) {
      event.preventDefault();
      onMove(index - 1);
    } else if (event.key === 'ArrowDown' && index < total - 1) {
      event.preventDefault();
      onMove(index + 1);
    }
  };
  return (
    <li
      draggable={!disabled}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      data-selected={selected || undefined}
      className={cn(
        'group/row flex h-11 items-center gap-0.5 rounded-lg border border-transparent pr-1 transition-colors hover:bg-muted/50 data-[selected]:bg-accent',
        dropTarget && 'border-dashed border-primary',
      )}
    >
      <button
        type="button"
        id={handleIdOf(field.id)}
        aria-label={t('models.builder.reorder', { label: field.label })}
        aria-describedby="field-reorder-help"
        onKeyDown={onHandleKeyDown}
        disabled={disabled}
        className="flex h-9 w-6 shrink-0 cursor-grab items-center justify-center rounded-md text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed"
      >
        <GripVertical className="size-4" aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected || undefined}
        className="flex h-9 min-w-0 flex-1 items-center gap-2.5 rounded-md px-1.5 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <Icon
          className={cn('size-4 shrink-0 text-muted-foreground', selected && 'text-accent-foreground')}
          aria-hidden="true"
        />
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block truncate text-sm font-medium">{field.label}</span>
          <span className="block truncate font-mono text-2xs text-muted-foreground">{field.apiKey}</span>
        </span>
        <span className="flex shrink-0 items-center gap-1">
          {field.required ? <Badge variant="outline">{t('models.builder.requiredBadge')}</Badge> : null}
          {showLocalized && field.localized ? (
            <Badge variant="outline">{t('models.builder.localizedBadge')}</Badge>
          ) : null}
          {field.public ? null : (
            <span title={t('models.builder.hiddenBadge')}>
              <EyeOff className="size-4 text-muted-foreground" aria-hidden="true" />
              <span className="sr-only">{t('models.builder.hiddenBadge')}</span>
            </span>
          )}
          {hasIssues ? (
            <span title={t('models.builder.hasProblems')}>
              <AlertCircle className="size-4 text-destructive" aria-hidden="true" />
              <span className="sr-only">{t('models.builder.hasProblems')}</span>
            </span>
          ) : null}
        </span>
      </button>
      <span className="hidden shrink-0 items-center group-focus-within/row:flex group-hover/row:flex">
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          tabIndex={-1}
          disabled={disabled || index === 0}
          aria-label={t('models.builder.moveUp', { label: field.label })}
          onClick={() => onMove(index - 1)}
        >
          <ChevronUp aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          tabIndex={-1}
          disabled={disabled || index === total - 1}
          aria-label={t('models.builder.moveDown', { label: field.label })}
          onClick={() => onMove(index + 1)}
        >
          <ChevronDown aria-hidden="true" />
        </Button>
      </span>
    </li>
  );
};
