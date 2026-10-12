import type { ContentAction } from '@shapio/client';
import type { FieldDefinition } from '@shapio/schema';
import { useTranslation } from 'react-i18next';
import { Field, FieldLegend, FieldSet } from '@/components/ui/field';
import { ACTION_COLUMN_KEYS } from '../constants';
import {
  actionHasOptions,
  canSetFields,
  canSetOwnOnly,
  fixedOptions,
  type ActionGrant,
  type MatrixAudience,
  type MatrixRules,
  type ModelGrants,
} from '../helpers/permissionMatrix';
import { FieldScope } from './FieldScope';
import { OwnOnly } from './OwnOnly';

type OptionsProps<A extends ContentAction> = {
  id: string;
  rules: MatrixRules<A>;
  rowKey: string;
  /** The model's fields; undefined for the every-model row (no field lists there). */
  fields: readonly FieldDefinition[] | undefined;
  grants: ModelGrants<A>;
  audience: MatrixAudience;
  readOnly: boolean;
  onChange: (action: A, changes: Partial<ActionGrant>) => void;
};

/**
 * Per granted action: "only their own entries" and, on a model, which fields it covers. Options the row
 * can't change (loaded from the API) are shown as they are.
 */
export const Options = <A extends ContentAction>({
  id,
  rules,
  rowKey,
  fields,
  grants,
  audience,
  readOnly,
  onChange,
}: OptionsProps<A>) => {
  const { t } = useTranslation();
  return (
    <div
      id={id}
      className="sticky left-0 grid max-w-[100cqw] gap-6 border-t bg-muted/40 px-5 py-4 @3xl:grid-cols-2"
    >
      {rules.actions.map((action) => {
        const grant = grants[action];
        if (!grant || !actionHasOptions(rowKey, action, grant, rules)) {
          return null;
        }
        const base = `${id}-${action}`;
        const fixed = fixedOptions(rowKey, action, grant, rules);
        return (
          <FieldSet key={action} className="gap-3">
            <FieldLegend variant="label">{t(ACTION_COLUMN_KEYS[action])}</FieldLegend>
            {canSetOwnOnly(action, rules) ? (
              <OwnOnly
                id={`${base}-own`}
                checked={grant.ownOnly}
                disabled={readOnly}
                onCheckedChange={(ownOnly) => onChange(action, { ownOnly })}
              />
            ) : null}
            {canSetFields(rowKey, action, rules) ? (
              <FieldScope
                id={base}
                fields={fields ?? []}
                fieldIds={grant.fieldIds}
                audience={audience}
                readOnly={readOnly}
                onChange={(fieldIds) => onChange(action, { fieldIds })}
              />
            ) : null}
            {fixed.ownOnly ? (
              <Field>
                <p className="text-meta text-muted-foreground">{t('roles.matrix.fixedOwnOnly')}</p>
              </Field>
            ) : null}
            {fixed.fieldIds !== null ? (
              <Field>
                <p className="text-meta text-muted-foreground">
                  {t('roles.matrix.fixedFields', { fields: fixed.fieldIds.join(', ') || '–' })}
                </p>
              </Field>
            ) : null}
          </FieldSet>
        );
      })}
    </div>
  );
};
