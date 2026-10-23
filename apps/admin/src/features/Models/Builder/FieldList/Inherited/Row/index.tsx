import type { FieldDefinition } from '@shapio/schema';
import { EyeOff, Lock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/helpers/cn';
import { DATA_TYPE_ICONS } from '../../../../constants';

type RowProps = {
  field: FieldDefinition;
  selected: boolean;
  showLocalized: boolean;
  /** What the field points at ("Page and 3 kinds"), for relations, components, and dynamic zones. */
  target?: string;
  onSelect: () => void;
};

/**
 * One inherited field (44px): locked, so no drag handle and no move buttons. Selecting it opens its
 * properties read-only; it changes on the type that declares it.
 */
export const Row = ({ field, selected, showLocalized, target, onSelect }: RowProps) => {
  const { t } = useTranslation();
  const Icon = DATA_TYPE_ICONS[field.type];
  return (
    <li
      data-selected={selected || undefined}
      className="flex h-11 items-center rounded-lg pr-1 pl-6 transition-colors hover:bg-muted/50 data-[selected]:bg-accent"
    >
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
          <span className="flex min-w-0 gap-1.5 text-2xs text-muted-foreground">
            <span className="min-w-0 truncate font-mono">{field.apiKey}</span>
            {target ? (
              <span className="min-w-0 truncate">{t('models.builder.pointsTo', { target })}</span>
            ) : null}
          </span>
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
          <span title={t('models.inheritance.locked')}>
            <Lock className="size-4 text-muted-foreground" aria-hidden="true" />
            <span className="sr-only">{t('models.inheritance.locked')}</span>
          </span>
        </span>
      </button>
    </li>
  );
};
