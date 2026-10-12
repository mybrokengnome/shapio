import type { FieldDefinition } from '@shapio/schema';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldLabel } from '@/components/ui/field';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { fieldChoices, type MatrixAudience } from '../../helpers/permissionMatrix';

type FieldScopeProps = {
  id: string;
  fields: readonly FieldDefinition[];
  /** `null`: every field the audience may see. */
  fieldIds: string[] | null;
  audience: MatrixAudience;
  readOnly: boolean;
  onChange: (fieldIds: string[] | null) => void;
};

const SCOPE_ALL = 'all';
const SCOPE_SELECTED = 'selected';

/**
 * Which fields one granted action covers: all of them (public ones only for app users and delivery tokens),
 * or the ones ticked. A ticked field the model no longer shows (deprecated, or gone) stays listed so it
 * can be cleared.
 */
export const FieldScope = ({ id, fields, fieldIds, audience, readOnly, onChange }: FieldScopeProps) => {
  const { t } = useTranslation();
  const { choices, defaultSelection } = fieldChoices(fields, fieldIds, audience);
  const selected = fieldIds ?? [];
  return (
    <>
      <RadioGroup
        aria-label={t('roles.matrix.fieldScope')}
        value={fieldIds === null ? SCOPE_ALL : SCOPE_SELECTED}
        disabled={readOnly}
        onValueChange={(value) => onChange(value === SCOPE_ALL ? null : defaultSelection)}
      >
        <Field orientation="horizontal">
          <RadioGroupItem id={`${id}-all`} value={SCOPE_ALL} />
          <FieldLabel htmlFor={`${id}-all`} className="font-normal">
            {audience === 'admin' ? t('roles.matrix.allFields') : t('roles.matrix.allPublicFields')}
          </FieldLabel>
        </Field>
        <Field orientation="horizontal">
          <RadioGroupItem id={`${id}-selected`} value={SCOPE_SELECTED} />
          <FieldLabel htmlFor={`${id}-selected`} className="font-normal">
            {t('roles.matrix.selectedFields')}
          </FieldLabel>
        </Field>
      </RadioGroup>
      {fieldIds === null ? null : (
        <div className="grid gap-2 pl-6 sm:grid-cols-2">
          {choices.map((choice) => {
            const checkboxId = `${id}-field-${choice.id}`;
            return (
              <Field key={choice.id} orientation="horizontal">
                <Checkbox
                  id={checkboxId}
                  checked={selected.includes(choice.id)}
                  disabled={readOnly}
                  onCheckedChange={(checked) =>
                    onChange(
                      checked === true
                        ? [...selected, choice.id].sort()
                        : selected.filter((fieldId) => fieldId !== choice.id),
                    )
                  }
                />
                <FieldLabel htmlFor={checkboxId} className="font-normal">
                  {choice.label ?? <span className="font-mono text-xs">{choice.id}</span>}
                  {choice.note === 'notPublic' ? (
                    <Badge variant="secondary">{t('roles.matrix.notPublic')}</Badge>
                  ) : null}
                  {choice.note === 'deprecated' ? (
                    <Badge variant="secondary">{t('roles.matrix.deprecatedField')}</Badge>
                  ) : null}
                  {choice.note === 'unknown' ? (
                    <Badge variant="secondary">{t('roles.matrix.unknownField')}</Badge>
                  ) : null}
                </FieldLabel>
              </Field>
            );
          })}
        </div>
      )}
    </>
  );
};
