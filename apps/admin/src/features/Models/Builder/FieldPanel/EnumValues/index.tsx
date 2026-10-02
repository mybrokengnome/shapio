import type { FieldDefinition, ValidationIssue } from '@shapio/schema';
import { Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { InfoHint } from '@/components/InfoHint';
import { Button } from '@/components/ui/button';
import { FieldLegend, FieldSet } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { issuesUnder } from '../../../helpers/issues';
import { IssueList } from '../../controls/IssueList';

type EnumValue = { value: string; label: string };

type EnumValuesProps = {
  idPrefix: string;
  field: FieldDefinition<'enum'>;
  path: string;
  issues: readonly ValidationIssue[];
  disabled: boolean;
  onChange: (values: EnumValue[]) => void;
};

/** The choices of an enum field: a stable value (a GraphQL name) and a label editors see. */
export const EnumValues = ({ idPrefix, field, path, issues, disabled, onChange }: EnumValuesProps) => {
  const { t } = useTranslation();
  const values = field.settings.values;
  const replace = (index: number, patch: Partial<EnumValue>) =>
    onChange(values.map((entry, position) => (position === index ? { ...entry, ...patch } : entry)));
  const listIssues = issues.filter((found) => found.path === path);
  return (
    <FieldSet className="gap-3" data-invalid={listIssues.length > 0 || undefined}>
      <FieldLegend variant="label" className="mb-0 flex items-center gap-1">
        {t('models.properties.values')}
        <InfoHint about={t('models.properties.values')}>{t('models.builder.enumValuesHint')}</InfoHint>
      </FieldLegend>
      {values.length > 0 ? (
        <ol className="space-y-2">
          {values.map((entry, index) => {
            const rowIssues = issuesUnder(issues, `${path}/${index}`);
            const valueId = `${idPrefix}-value-${index}`;
            const labelId = `${idPrefix}-label-${index}`;
            return (
              <li key={index} className="space-y-1">
                <div className="flex items-center gap-2">
                  <label htmlFor={labelId} className="sr-only">
                    {t('models.builder.enumLabel', { position: index + 1 })}
                  </label>
                  <Input
                    id={labelId}
                    value={entry.label}
                    placeholder={t('models.builder.enumLabelPlaceholder')}
                    disabled={disabled}
                    onChange={(event) => replace(index, { label: event.target.value })}
                  />
                  <label htmlFor={valueId} className="sr-only">
                    {t('models.builder.enumValue', { position: index + 1 })}
                  </label>
                  <Input
                    id={valueId}
                    value={entry.value}
                    placeholder={t('models.builder.enumValuePlaceholder')}
                    className="font-mono"
                    spellCheck={false}
                    disabled={disabled}
                    aria-invalid={rowIssues.length > 0 || undefined}
                    onChange={(event) => replace(index, { value: event.target.value })}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={disabled}
                    aria-label={t('models.builder.enumRemove', { position: index + 1 })}
                    onClick={() => onChange(values.filter((_, position) => position !== index))}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </div>
                <IssueList issues={rowIssues} />
              </li>
            );
          })}
        </ol>
      ) : null}
      <IssueList issues={listIssues} />
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-fit"
        disabled={disabled}
        onClick={() => onChange([...values, { value: '', label: '' }])}
      >
        <Plus aria-hidden="true" />
        {t('models.builder.enumAdd')}
      </Button>
    </FieldSet>
  );
};
