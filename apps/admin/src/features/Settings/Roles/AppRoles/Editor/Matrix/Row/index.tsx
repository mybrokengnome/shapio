import type { AppContentAction } from '@shapio/client';
import { ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { TableCell, TableRow } from '@/components/ui/table';
import { cn } from '@/helpers/cn';
import { ACTION_COLUMN_KEYS, APP_CONTENT_ACTIONS } from '../../../constants';
import type { ModelGrants } from '../../../helpers/permissionMatrix';

type RowProps = {
  label: string;
  /** API key or a hint beside the label. */
  detail: string;
  grants: ModelGrants;
  optionsId: string;
  expanded: boolean;
  /** False when no granted action on this row has options. */
  canExpand: boolean;
  onToggle: (action: AppContentAction, granted: boolean) => void;
  onToggleExpanded: () => void;
};

/** One model (or every model): a 36px row with a checkbox per action and the button that shows its options. */
export const Row = ({
  label,
  detail,
  grants,
  optionsId,
  expanded,
  canExpand,
  onToggle,
  onToggleExpanded,
}: RowProps) => {
  const { t } = useTranslation();
  return (
    <TableRow className="hover:bg-transparent has-aria-expanded:bg-transparent">
      <TableCell className="sticky left-0 z-10 h-9 bg-card py-0">
        <span className="flex items-baseline gap-2">
          <span className="font-semibold">{label}</span>
          <span className="truncate text-xs text-muted-foreground">{detail}</span>
        </span>
      </TableCell>
      {APP_CONTENT_ACTIONS.map((action) => (
        <TableCell key={action} className="h-9 py-0 text-center">
          <Checkbox
            checked={grants[action] !== undefined}
            onCheckedChange={(checked) => onToggle(action, checked === true)}
            aria-label={`${t(ACTION_COLUMN_KEYS[action])}: ${label}`}
            className="align-middle"
          />
        </TableCell>
      ))}
      <TableCell className="h-9 py-0 text-right">
        <Button
          type="button"
          variant="ghost"
          size="xs"
          disabled={!canExpand}
          aria-expanded={expanded}
          aria-controls={expanded ? optionsId : undefined}
          aria-label={`${t('appRoles.options')}: ${label}`}
          onClick={onToggleExpanded}
        >
          {t('appRoles.options')}
          <ChevronDown aria-hidden="true" className={cn('transition-transform', expanded && 'rotate-180')} />
        </Button>
      </TableCell>
    </TableRow>
  );
};
