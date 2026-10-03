import { Plus, X } from 'lucide-react';
import {
  useFieldArray,
  useFormState,
  useWatch,
  type ArrayPath,
  type Control,
  type FieldArray,
  type FieldPath,
} from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { FormFieldError } from '@/components/FormFieldError';
import type { RadioOption } from '@/components/FormRadioGroup';
import { FormRadioGroup } from '@/components/FormRadioGroup';
import { FormSelectField, type SelectOption } from '@/components/FormSelectField';
import { Button } from '@/components/ui/button';
import { FieldLegend, FieldSet } from '@/components/ui/field';
import { nextAssignmentRow, type AssignmentsValues } from '../helpers/assignments';

type AssignmentsFieldProps<TValues extends AssignmentsValues> = {
  control: Control<TValues>;
  roleOptions: readonly RadioOption[];
  siteOptions: readonly SelectOption[];
  siteIds: readonly string[];
  /** One site on the instance: just the role (on every site), as before there were sites. */
  multiSite: boolean;
  /** The role a new row starts with. */
  defaultRoleId: string | undefined;
};

/**
 * Where an admin works (sites plan §H): one row per site, each a role on that site or on all sites. With a
 * single site there is nothing to choose but the role, so it is the role alone.
 */
export const AssignmentsField = <TValues extends AssignmentsValues>({
  control,
  roleOptions,
  siteOptions,
  siteIds,
  multiSite,
  defaultRoleId,
}: AssignmentsFieldProps<TValues>) => {
  const { t } = useTranslation();
  const { fields, append, remove } = useFieldArray({ control, name: 'rows' as ArrayPath<TValues> });
  const { errors } = useFormState({ control, name: 'rows' as FieldPath<TValues> });
  const rows = useWatch({ control, name: 'rows' as FieldPath<TValues> }) as
    AssignmentsValues['rows'] | undefined;
  const path = (index: number, key: 'site' | 'roleId') => `rows.${index}.${key}` as FieldPath<TValues>;
  if (!multiSite) {
    return (
      <FormRadioGroup
        control={control}
        name={path(0, 'roleId')}
        legend={t('users.role')}
        options={roleOptions}
      />
    );
  }
  const next = nextAssignmentRow(rows ?? [], siteIds, defaultRoleId ?? '');
  const rootError = (errors as { rows?: { root?: { message?: string }; message?: string } }).rows;
  return (
    <FieldSet>
      <FieldLegend variant="label">{t('users.access.title')}</FieldLegend>
      <div className="space-y-3">
        {fields.map((field, index) => (
          <fieldset
            key={field.id}
            aria-label={t('users.access.row', { n: index + 1 })}
            className="grid grid-cols-[1fr_1fr_auto] items-start gap-3"
          >
            <FormSelectField
              control={control}
              name={path(index, 'site')}
              label={t('users.access.site')}
              options={siteOptions}
            />
            <FormSelectField
              control={control}
              name={path(index, 'roleId')}
              label={t('users.role')}
              options={roleOptions}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="mt-7"
              disabled={fields.length === 1}
              aria-label={t('users.access.remove', { n: index + 1 })}
              onClick={() => remove(index)}
            >
              <X aria-hidden="true" />
            </Button>
          </fieldset>
        ))}
      </div>
      <FormFieldError message={rootError?.root?.message ?? rootError?.message} />
      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!next}
          onClick={() => next && append(next as FieldArray<TValues, ArrayPath<TValues>>)}
        >
          <Plus aria-hidden="true" />
          {t('users.access.add')}
        </Button>
      </div>
    </FieldSet>
  );
};
