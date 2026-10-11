import { MAX_LABEL_LENGTH, type ModelDefinition, type ValidationIssue } from '@shapio/schema';
import { Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { InfoHint } from '@/components/InfoHint';
import { Button } from '@/components/ui/button';
import { FieldDescription, FieldLegend, FieldSet } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useDefinitionDraftStore } from '@/stores/definitionDraft';
import { withGroupLabel, withoutGroup } from '../../../../helpers/groups';
import { issuesUnder } from '../../../../helpers/issues';
import { IssueList } from '../../../controls/IssueList';

type GroupsProps = {
  model: ModelDefinition;
  /** Issues under `/display/groups`. */
  issues: readonly ValidationIssue[];
  disabled: boolean;
};

const GROUPS_PATH = '/display/groups';

/**
 * The model's groups (`display.groups`, the form's sections): rename one, or remove it to ungroup its fields.
 * Fields join a group from their own settings; there is no ordering here, since field order places groups.
 */
export const Groups = ({ model, issues, disabled }: GroupsProps) => {
  const { t } = useTranslation();
  const update = useDefinitionDraftStore((state) => state.update);
  const groups = model.display.groups ?? [];
  const listIssues = issues.filter((found) => found.path === GROUPS_PATH);
  const apply = (change: (current: ModelDefinition) => ModelDefinition) =>
    update((current) => (current.kind === 'component' ? current : change(current)));
  return (
    <FieldSet className="gap-3" data-invalid={issues.length > 0 || undefined}>
      <FieldLegend variant="label" className="mb-0 flex items-center gap-1">
        {t('models.builder.groups')}
        <InfoHint about={t('models.builder.groups')}>{t('models.builder.groupsHint')}</InfoHint>
      </FieldLegend>
      {groups.length === 0 ? <FieldDescription>{t('models.builder.groupsEmpty')}</FieldDescription> : null}
      {groups.length > 0 ? (
        <ol className="space-y-2">
          {groups.map((group, index) => {
            const groupIssues = issuesUnder(issues, `${GROUPS_PATH}/${index}`);
            const inputId = `definition-group-${index}`;
            const errorId = groupIssues.length > 0 ? `${inputId}-error` : undefined;
            return (
              <li key={group.id} className="space-y-1">
                <div className="flex items-center gap-2">
                  <label htmlFor={inputId} className="sr-only">
                    {t('models.builder.groupLabel', { position: index + 1 })}
                  </label>
                  <Input
                    id={inputId}
                    value={group.label}
                    autoComplete="off"
                    maxLength={MAX_LABEL_LENGTH}
                    disabled={disabled}
                    aria-invalid={groupIssues.length > 0 || undefined}
                    aria-describedby={errorId}
                    onChange={(event) =>
                      apply((current) => withGroupLabel(current, group.id, event.target.value))
                    }
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={disabled}
                    aria-label={t('models.builder.groupRemove', { label: group.label || index + 1 })}
                    onClick={() => apply((current) => withoutGroup(current, group.id))}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </div>
                <IssueList id={errorId} issues={groupIssues} />
              </li>
            );
          })}
        </ol>
      ) : null}
      <IssueList issues={listIssues} />
    </FieldSet>
  );
};
