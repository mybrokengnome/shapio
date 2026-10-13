import type { ContentAction } from '@shapio/client';
import { ChevronDown, CornerDownRight, CornerLeftUp } from 'lucide-react';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { SharedGlyph } from '@/components/SharedGlyph';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { TableCell, TableRow } from '@/components/ui/table';
import { cn } from '@/helpers/cn';
import { ACTION_COLUMN_KEYS } from '../constants';
import type { InheritedGrants, ModelGrants } from '../helpers/permissionMatrix';

type RowProps<A extends ContentAction> = {
  /** The matrix's columns, in order. */
  actions: readonly A[];
  label: string;
  /** API key or a hint beside the label. */
  detail: string;
  /** Shared with all sites: a globe beside the label. */
  shared: boolean;
  /** The site a site's own model belongs to, when there are several sites. */
  siteName: string | undefined;
  readOnly: boolean;
  grants: ModelGrants<A>;
  /** Levels below a root type (a kind is 1); kinds are indented under their parent. */
  depth: number;
  /** The type a kind extends; undefined for a root (and the every-model row). */
  parentLabel: string | undefined;
  /** What the row inherits from its ancestors, per action (shown read-only). */
  inherited: InheritedGrants<A>;
  nameOf: (modelId: string) => string;
  optionsId: string;
  expanded: boolean;
  /** False when no granted action on this row has options. */
  canExpand: boolean;
  onToggle: (action: A, granted: boolean) => void;
  onToggleExpanded: () => void;
};

/**
 * One model (or every model): a 36px row with a checkbox per action and the button that shows its options.
 * A kind is indented under its parent; an action it inherits shows a read-only mark before its own
 * checkbox (its own grant adds to the inherited one).
 */
export const Row = <A extends ContentAction>({
  actions,
  label,
  detail,
  shared,
  siteName,
  readOnly,
  grants,
  depth,
  parentLabel,
  inherited,
  nameOf,
  optionsId,
  expanded,
  canExpand,
  onToggle,
  onToggleExpanded,
}: RowProps<A>) => {
  const { t } = useTranslation();
  return (
    <TableRow className="hover:bg-transparent has-aria-expanded:bg-transparent">
      <TableCell className="sticky left-0 z-10 h-9 bg-card py-0">
        <span
          className="flex items-baseline gap-2 pl-[calc(var(--depth)*1.25rem)]"
          // The depth is data: a kind sits one step further in than its parent.
          style={{ '--depth': Math.max(depth - 1, 0) } as CSSProperties}
        >
          {depth > 0 ? (
            <CornerDownRight
              aria-hidden="true"
              className="size-3.5 shrink-0 self-center text-muted-foreground"
            />
          ) : null}
          <span className="font-semibold">{label}</span>
          {shared ? <SharedGlyph className="self-center" /> : null}
          <span className="truncate text-xs text-muted-foreground">
            {siteName ? `${siteName} · ${detail}` : detail}
            {parentLabel ? ` · ${t('roles.matrix.inheritedFrom', { model: parentLabel })}` : null}
          </span>
        </span>
      </TableCell>
      {actions.map((action) => {
        const actionLabel = t(ACTION_COLUMN_KEYS[action]);
        const from = inherited[action]?.map((entry) => nameOf(entry.modelId)).join(', ');
        return (
          <TableCell key={action} className="h-9 py-0 text-center">
            <span className="inline-flex items-center gap-1.5 align-middle">
              {from ? (
                <span title={t('roles.matrix.inheritedAction', { action: actionLabel, model: from })}>
                  <CornerLeftUp aria-hidden="true" className="size-3.5 text-muted-foreground" />
                  <span className="sr-only">
                    {t('roles.matrix.inheritedAction', { action: actionLabel, model: from })}
                  </span>
                </span>
              ) : null}
              <Checkbox
                checked={grants[action] !== undefined}
                disabled={readOnly}
                onCheckedChange={(checked) => onToggle(action, checked === true)}
                aria-label={`${actionLabel}: ${label}`}
              />
            </span>
          </TableCell>
        );
      })}
      <TableCell className="h-9 py-0 text-right">
        <Button
          type="button"
          variant="ghost"
          size="xs"
          disabled={!canExpand}
          aria-expanded={expanded}
          aria-controls={expanded ? optionsId : undefined}
          aria-label={`${t('roles.matrix.options')}: ${label}`}
          onClick={onToggleExpanded}
        >
          {t('roles.matrix.options')}
          <ChevronDown aria-hidden="true" className={cn('transition-transform', expanded && 'rotate-180')} />
        </Button>
      </TableCell>
    </TableRow>
  );
};
