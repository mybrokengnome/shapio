import type { ContentAction } from '@shapio/client';
import type { FieldDefinition } from '@shapio/schema';
import { useTranslation } from 'react-i18next';
import { Field } from '@/components/ui/field';
import {
  canSetFields,
  canSetOwnOnly,
  fixedOptions,
  type ActionGrant,
  type MatrixAudience,
  type MatrixRules,
} from '../../helpers/permissionMatrix';
import { FieldScope } from '../FieldScope';
import { OwnOnly } from '../OwnOnly';

type OwnGrantProps<A extends ContentAction> = {
  base: string;
  action: A;
  rowKey: string;
  grant: ActionGrant;
  rules: MatrixRules<A>;
  fields: readonly FieldDefinition[] | undefined;
  audience: MatrixAudience;
  readOnly: boolean;
  onChange: (action: A, changes: Partial<ActionGrant>) => void;
};

/** The row's own grant of one action: own entries, the field list, and options set through the API. */
export const OwnGrant = <A extends ContentAction>({
  base,
  action,
  rowKey,
  grant,
  rules,
  fields,
  audience,
  readOnly,
  onChange,
}: OwnGrantProps<A>) => {
  const { t } = useTranslation();
  const fixed = fixedOptions(rowKey, action, grant, rules);
  return (
    <>
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
    </>
  );
};
