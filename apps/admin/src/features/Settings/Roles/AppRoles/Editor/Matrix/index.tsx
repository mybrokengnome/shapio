import type { DefinitionListItem } from '@shapio/client';
import { isModelDefinition } from '@shapio/schema';
import { Fragment, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ACTION_COLUMN_KEYS, ALL_MODELS, APP_CONTENT_ACTIONS } from '../../constants';
import {
  columnState,
  hasOptions,
  setColumn,
  setGranted,
  updateGrant,
  type PermissionMatrix,
} from '../../helpers/permissionMatrix';
import { Options } from './Options';
import { Row } from './Row';

type MatrixProps = {
  matrix: PermissionMatrix;
  models: readonly DefinitionListItem[];
  onChange: (matrix: PermissionMatrix) => void;
};

/**
 * Models × actions. The first row grants on every model, including ones created later; each column's header
 * checkbox grants or revokes that action on every row. The model column stays put while the table scrolls.
 */
export const Matrix = ({ matrix, models, onChange }: MatrixProps) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const toggleExpanded = (key: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (!next.delete(key)) {
        next.add(key);
      }
      return next;
    });
  const rows = [
    {
      key: ALL_MODELS,
      label: t('appRoles.allModels'),
      detail: t('appRoles.allModelsHint'),
      fields: undefined,
    },
    ...models
      .map((item) => item.definition)
      .filter(isModelDefinition)
      .map((definition) => ({
        key: definition.id,
        label: definition.label,
        detail: definition.apiKey,
        fields: definition.fields,
      })),
  ];
  const keys = rows.map((row) => row.key);
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="sticky left-0 z-10 min-w-60 bg-muted">{t('appRoles.model')}</TableHead>
          {APP_CONTENT_ACTIONS.map((action) => {
            const label = t(ACTION_COLUMN_KEYS[action]);
            return (
              <TableHead key={action} className="w-24 bg-muted">
                <span className="flex items-center justify-center gap-2">
                  <Checkbox
                    checked={columnState(matrix, keys, action)}
                    onCheckedChange={(checked) => onChange(setColumn(matrix, keys, action, checked === true))}
                    aria-label={t('appRoles.everyRow', { action: label })}
                  />
                  {label}
                </span>
              </TableHead>
            );
          })}
          <TableHead className="bg-muted">
            <span className="sr-only">{t('appRoles.options')}</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => {
          const grants = matrix[row.key] ?? {};
          const canExpand = hasOptions(row.key, grants);
          const isExpanded = canExpand && expanded.has(row.key);
          const optionsId = `app-role-options-${row.key === ALL_MODELS ? 'all' : row.key}`;
          return (
            <Fragment key={row.key}>
              <Row
                label={row.label}
                detail={row.detail}
                grants={grants}
                optionsId={optionsId}
                expanded={isExpanded}
                canExpand={canExpand}
                onToggle={(action, granted) => onChange(setGranted(matrix, row.key, action, granted))}
                onToggleExpanded={() => toggleExpanded(row.key)}
              />
              {isExpanded ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell
                    colSpan={APP_CONTENT_ACTIONS.length + 2}
                    className="h-auto p-0 whitespace-normal"
                  >
                    <Options
                      id={optionsId}
                      rowKey={row.key}
                      fields={row.fields}
                      grants={grants}
                      onChange={(action, changes) => onChange(updateGrant(matrix, row.key, action, changes))}
                    />
                  </TableCell>
                </TableRow>
              ) : null}
            </Fragment>
          );
        })}
      </TableBody>
    </Table>
  );
};
