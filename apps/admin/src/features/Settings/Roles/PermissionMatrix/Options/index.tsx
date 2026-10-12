import type { ContentAction } from '@shapio/client';
import type { FieldDefinition } from '@shapio/schema';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Switch } from '@/components/ui/switch';
import { ACTION_COLUMN_KEYS, ALL_MODELS } from '../constants';
import type { ActionGrant, MatrixRules, ModelGrants } from '../helpers/permissionMatrix';

type OptionsProps<A extends ContentAction> = {
  id: string;
  rules: MatrixRules<A>;
  rowKey: string;
  /** The model's fields; undefined for the every-model row (no field lists there). */
  fields: readonly FieldDefinition[] | undefined;
  grants: ModelGrants<A>;
  onChange: (action: A, changes: Partial<ActionGrant>) => void;
};

const SCOPE_ALL = 'all';
const SCOPE_SELECTED = 'selected';

/** Per granted action: "only their own entries" and, on a model, which fields it covers. */
export const Options = <A extends ContentAction>({
  id,
  rules,
  rowKey,
  fields,
  grants,
  onChange,
}: OptionsProps<A>) => {
  const { t } = useTranslation();
  const liveFields = (fields ?? []).filter((field) => !field.deprecated);
  return (
    <div id={id} className="grid gap-6 border-t bg-muted/40 px-5 py-4 md:grid-cols-2">
      {rules.actions.map((action) => {
        const grant = grants[action];
        const ownOnly = rules.ownOnlyActions.has(action);
        const fieldScoped = rowKey !== ALL_MODELS && rules.fieldScopedActions.has(action);
        if (!grant || (!ownOnly && !fieldScoped)) {
          return null;
        }
        const base = `${id}-${action}`;
        return (
          <FieldSet key={action} className="gap-3">
            <FieldLegend variant="label">{t(ACTION_COLUMN_KEYS[action])}</FieldLegend>
            {ownOnly ? (
              <Field orientation="horizontal">
                <FieldLabel htmlFor={`${base}-own`}>{t('roles.matrix.ownOnly')}</FieldLabel>
                <Switch
                  id={`${base}-own`}
                  checked={grant.ownOnly}
                  onCheckedChange={(checked) => onChange(action, { ownOnly: checked })}
                />
              </Field>
            ) : null}
            {fieldScoped ? (
              <>
                <RadioGroup
                  aria-label={t('roles.matrix.fieldScope')}
                  value={grant.fieldIds === null ? SCOPE_ALL : SCOPE_SELECTED}
                  onValueChange={(value) =>
                    onChange(action, {
                      fieldIds:
                        value === SCOPE_ALL
                          ? null
                          : liveFields.filter((field) => field.public).map((field) => field.id),
                    })
                  }
                >
                  <Field orientation="horizontal">
                    <RadioGroupItem id={`${base}-all`} value={SCOPE_ALL} />
                    <FieldLabel htmlFor={`${base}-all`} className="font-normal">
                      {t('roles.matrix.allPublicFields')}
                    </FieldLabel>
                  </Field>
                  <Field orientation="horizontal">
                    <RadioGroupItem id={`${base}-selected`} value={SCOPE_SELECTED} />
                    <FieldLabel htmlFor={`${base}-selected`} className="font-normal">
                      {t('roles.matrix.selectedFields')}
                    </FieldLabel>
                  </Field>
                </RadioGroup>
                {grant.fieldIds === null ? null : (
                  <div className="grid gap-2 pl-6 sm:grid-cols-2">
                    {liveFields.map((field) => {
                      const selected = grant.fieldIds ?? [];
                      const checkboxId = `${base}-field-${field.id}`;
                      return (
                        <Field key={field.id} orientation="horizontal">
                          <Checkbox
                            id={checkboxId}
                            checked={selected.includes(field.id)}
                            onCheckedChange={(checked) =>
                              onChange(action, {
                                fieldIds:
                                  checked === true
                                    ? [...selected, field.id].sort()
                                    : selected.filter((fieldId) => fieldId !== field.id),
                              })
                            }
                          />
                          <FieldLabel htmlFor={checkboxId} className="font-normal">
                            {field.label}
                            {field.public ? null : (
                              <Badge variant="secondary">{t('roles.matrix.notPublic')}</Badge>
                            )}
                          </FieldLabel>
                        </Field>
                      );
                    })}
                  </div>
                )}
              </>
            ) : null}
          </FieldSet>
        );
      })}
    </div>
  );
};
