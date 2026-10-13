import type { ContentAction } from '@shapio/client';
import { createDefinitionIndex } from '@shapio/schema';
import { Fragment, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SiteModel } from '@/api/schema';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { orderAsTree } from '@/features/Models/helpers/tree';
import { ACTION_COLUMN_KEYS, ALL_MODELS } from './constants';
import {
  columnState,
  hasOptions,
  inheritedGrantsOf,
  setColumn,
  setGranted,
  updateGrant,
  type MatrixAudience,
  type MatrixRules,
  type PermissionMatrix as Matrix,
} from './helpers/permissionMatrix';
import { Options } from './Options';
import { Row } from './Row';
import { Unlisted } from './Unlisted';

type PermissionMatrixProps<A extends ContentAction> = {
  matrix: Matrix<A>;
  /** Every site's models (shared ones once). */
  models: readonly SiteModel[];
  /** Name each site's own models (more than one site). */
  showSites: boolean;
  rules: MatrixRules<A>;
  audience: MatrixAudience;
  /** Shown, not changed (built-in admin roles). */
  readOnly?: boolean;
  onChange: (matrix: Matrix<A>) => void;
};

/**
 * Models × actions. The first row grants on every model, including ones created later; each column's header
 * checkbox grants or revokes that action on every row. The model column stays put while the table scrolls.
 * Kinds sit under the type they extend and show what they inherit from it, read-only, beside their own
 * grants (which can only add to it). Grants on models no site has any more are listed under the table, to
 * remove.
 */
export const PermissionMatrix = <A extends ContentAction>({
  matrix,
  models,
  showSites,
  rules,
  audience,
  readOnly = false,
  onChange,
}: PermissionMatrixProps<A>) => {
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
  // Every site's models together: shared parents and their kinds are on the same site or both shared.
  const index = useMemo(() => createDefinitionIndex(models.map(({ definition }) => definition)), [models]);
  const tree = useMemo(
    () =>
      orderAsTree(
        models,
        ({ definition }) => definition.id,
        ({ definition }) => definition.extends,
      ),
    [models],
  );
  const nameOf = (modelId: string) => index.get(modelId)?.label ?? modelId;
  const rows = [
    {
      key: ALL_MODELS,
      label: t('roles.matrix.allModels'),
      detail: t('roles.matrix.allModelsHint'),
      shared: false,
      siteName: undefined,
      fields: undefined,
      depth: 0,
      parentLabel: undefined,
      ancestorIds: [] as readonly string[],
    },
    ...tree.map(({ item: { definition, site }, depth, parentId }) => ({
      key: definition.id,
      label: definition.label,
      detail: definition.apiKey,
      shared: site === null,
      siteName: showSites ? site?.name : undefined,
      // A kind's grants can name its inherited fields too (their IDs are the parent's).
      fields: index.resolve(definition.id)?.fields ?? definition.fields,
      depth,
      parentLabel: parentId === undefined ? undefined : nameOf(parentId),
      ancestorIds: index.ancestors(definition.id),
    })),
  ];
  const hasKinds = rows.some((row) => row.parentLabel !== undefined);
  const keys = rows.map((row) => row.key);
  // The panel's width: options stay in view (sticky, as wide as the panel) when the table scrolls sideways.
  return (
    <div className="@container">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="sticky left-0 z-10 min-w-60 bg-muted">{t('roles.matrix.model')}</TableHead>
            {rules.actions.map((action) => {
              const label = t(ACTION_COLUMN_KEYS[action]);
              return (
                <TableHead key={action} className="w-24 bg-muted">
                  <span className="flex items-center justify-center gap-2">
                    <Checkbox
                      checked={columnState(matrix, keys, action)}
                      disabled={readOnly}
                      onCheckedChange={(checked) =>
                        onChange(setColumn(matrix, keys, action, checked === true))
                      }
                      aria-label={t('roles.matrix.everyRow', { action: label })}
                    />
                    {label}
                  </span>
                </TableHead>
              );
            })}
            <TableHead className="bg-muted">
              <span className="sr-only">{t('roles.matrix.options')}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const grants = matrix[row.key] ?? {};
            const inherited = inheritedGrantsOf(matrix, row.ancestorIds, rules);
            const inheritsAny = Object.keys(inherited).length > 0;
            const canExpand = hasOptions(row.key, grants, rules) || inheritsAny;
            const isExpanded = canExpand && expanded.has(row.key);
            const optionsId = `permission-options-${row.key === ALL_MODELS ? 'all' : row.key}`;
            return (
              <Fragment key={row.key}>
                <Row
                  actions={rules.actions}
                  label={row.label}
                  detail={row.detail}
                  shared={row.shared}
                  siteName={row.siteName}
                  readOnly={readOnly}
                  grants={grants}
                  depth={row.depth}
                  parentLabel={row.parentLabel}
                  inherited={inherited}
                  nameOf={nameOf}
                  optionsId={optionsId}
                  expanded={isExpanded}
                  canExpand={canExpand}
                  onToggle={(action, granted) => onChange(setGranted(matrix, row.key, action, granted))}
                  onToggleExpanded={() => toggleExpanded(row.key)}
                />
                {isExpanded ? (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={rules.actions.length + 2} className="h-auto p-0 whitespace-normal">
                      <Options
                        id={optionsId}
                        rules={rules}
                        rowKey={row.key}
                        fields={row.fields}
                        grants={grants}
                        inherited={inherited}
                        nameOf={nameOf}
                        audience={audience}
                        readOnly={readOnly}
                        onChange={(action, changes) =>
                          onChange(updateGrant(matrix, row.key, action, changes))
                        }
                      />
                    </TableCell>
                  </TableRow>
                ) : null}
              </Fragment>
            );
          })}
        </TableBody>
      </Table>
      {hasKinds ? (
        <p className="sticky left-0 max-w-[100cqw] border-t px-5 py-3 text-meta text-muted-foreground">
          {t('roles.matrix.inheritanceNote')}
        </p>
      ) : null}
      <Unlisted
        matrix={matrix}
        listedKeys={new Set(keys)}
        rules={rules}
        readOnly={readOnly}
        onRemove={(modelId, action) => onChange(setGranted(matrix, modelId, action, false))}
      />
    </div>
  );
};
