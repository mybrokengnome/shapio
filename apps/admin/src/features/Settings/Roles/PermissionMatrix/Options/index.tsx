import type { ContentAction } from '@shapio/client';
import type { FieldDefinition } from '@shapio/schema';
import { useTranslation } from 'react-i18next';
import { Field, FieldLegend, FieldSet } from '@/components/ui/field';
import { ACTION_COLUMN_KEYS } from '../constants';
import {
  actionHasOptions,
  type ActionGrant,
  type InheritedGrant,
  type InheritedGrants,
  type MatrixAudience,
  type MatrixRules,
  type ModelGrants,
} from '../helpers/permissionMatrix';
import { OwnGrant } from './OwnGrant';

type OptionsProps<A extends ContentAction> = {
  id: string;
  rules: MatrixRules<A>;
  rowKey: string;
  /** The model's fields; undefined for the every-model row (no field lists there). */
  fields: readonly FieldDefinition[] | undefined;
  grants: ModelGrants<A>;
  /** What a kind inherits per action, shown read-only above its own options. */
  inherited: InheritedGrants<A>;
  nameOf: (modelId: string) => string;
  audience: MatrixAudience;
  readOnly: boolean;
  onChange: (action: A, changes: Partial<ActionGrant>) => void;
};

/**
 * Per granted action: "only their own entries" and, on a model, which fields it covers. Options the row
 * can't change (loaded from the API) are shown as they are, and so is what a kind inherits for the action
 * (its own grant can only add to that).
 */
export const Options = <A extends ContentAction>({
  id,
  rules,
  rowKey,
  fields,
  grants,
  inherited,
  nameOf,
  audience,
  readOnly,
  onChange,
}: OptionsProps<A>) => {
  const { t } = useTranslation();
  const fieldLabel = (fieldId: string) => fields?.find((field) => field.id === fieldId)?.label ?? fieldId;
  /** "Inherited from Products: all fields, only their own entries". */
  const describeInherited = ({ modelId, grant }: InheritedGrant) =>
    t(grant.ownOnly ? 'roles.matrix.inheritedGrantOwnOnly' : 'roles.matrix.inheritedGrant', {
      model: nameOf(modelId),
      fields:
        grant.fieldIds === null
          ? audience === 'admin'
            ? t('roles.matrix.allFields')
            : t('roles.matrix.allPublicFields')
          : grant.fieldIds.map(fieldLabel).join(', ') || '–',
    });
  return (
    <div
      id={id}
      className="sticky left-0 grid max-w-[100cqw] gap-6 border-t bg-muted/40 px-5 py-4 @3xl:grid-cols-2"
    >
      {rules.actions.map((action) => {
        const grant = grants[action];
        const fromAncestors = inherited[action] ?? [];
        const ownOptions = grant !== undefined && actionHasOptions(rowKey, action, grant, rules);
        if (!ownOptions && fromAncestors.length === 0) {
          return null;
        }
        const base = `${id}-${action}`;
        return (
          <FieldSet key={action} className="gap-3">
            <FieldLegend variant="label">{t(ACTION_COLUMN_KEYS[action])}</FieldLegend>
            {fromAncestors.map((entry) => (
              <Field key={entry.modelId}>
                <p className="text-meta text-muted-foreground">{describeInherited(entry)}</p>
              </Field>
            ))}
            {fromAncestors.length > 0 ? (
              <Field>
                <p className="text-meta text-muted-foreground">{t('roles.matrix.widenOnly')}</p>
              </Field>
            ) : null}
            {grant && ownOptions ? (
              <OwnGrant
                base={base}
                action={action}
                rowKey={rowKey}
                grant={grant}
                rules={rules}
                fields={fields}
                audience={audience}
                readOnly={readOnly}
                onChange={onChange}
              />
            ) : null}
          </FieldSet>
        );
      })}
    </div>
  );
};
