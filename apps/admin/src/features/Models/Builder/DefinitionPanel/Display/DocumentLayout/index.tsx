import type { ModelDefinition, ValidationIssue } from '@shapio/schema';
import { useTranslation } from 'react-i18next';
import { useDefinitionDraftStore } from '@/stores/definitionDraft';
import { documentLayoutChoices } from '../../../../helpers/display';
import { pruneLayout, withKey } from '../../../../helpers/draft';
import { issuesUnder } from '../../../../helpers/issues';
import { ChoicesControl } from '../../../controls/ChoicesControl';
import { SelectControl } from '../../../controls/SelectControl';

type DocumentLayoutProps = { model: ModelDefinition; issues: readonly ValidationIssue[]; disabled: boolean };

const option = (field: { id: string; label: string }) => ({ value: field.id, label: field.label });

/**
 * How an entry opens as a document (`effectiveLayout`): the cover image, the fields written in the canvas,
 * and the properties shown as chips. Unset keys follow the defaults, so new fields join automatically.
 */
export const DocumentLayout = ({ model, issues, disabled }: DocumentLayoutProps) => {
  const { t } = useTranslation();
  const update = useDefinitionDraftStore((state) => state.update);
  const setDisplay = (key: string, value: unknown) =>
    update((draft) => pruneLayout({ ...draft, display: withKey(draft.display, key, value) }));
  const at = (key: string) => issuesUnder(issues, `/display/${key}`);
  const choices = documentLayoutChoices(model);
  return (
    <>
      {choices.coverOptions.length > 0 ? (
        <SelectControl
          id="definition-cover-field"
          label={t('models.builder.coverField')}
          hint={t('models.builder.coverFieldHint')}
          value={model.display.coverFieldId}
          options={choices.coverOptions.map(option)}
          onChange={(value) => setDisplay('coverFieldId', value)}
          unsetLabel={t('models.builder.automatic')}
          issues={at('coverFieldId')}
          disabled={disabled}
        />
      ) : null}
      {choices.canvasOptions.length > 0 ? (
        <ChoicesControl
          id="definition-canvas-fields"
          label={t('models.builder.canvasFields')}
          hint={t('models.builder.canvasFieldsHint')}
          value={choices.canvas}
          options={choices.canvasOptions.map(option)}
          // An empty list means "the defaults", so the last block can't be unticked.
          locked={choices.canvas.length === 1 ? choices.canvas : []}
          onChange={(ids) => setDisplay('canvasFieldIds', ids.length > 0 ? ids : undefined)}
          issues={at('canvasFieldIds')}
          disabled={disabled}
        />
      ) : null}
      {choices.stripOptions.length > 0 ? (
        <ChoicesControl
          id="definition-strip-fields"
          label={t('models.builder.stripFields')}
          hint={t('models.builder.stripFieldsHint')}
          value={model.display.stripFieldIds ?? []}
          options={choices.stripOptions.map(option)}
          onChange={(ids) => setDisplay('stripFieldIds', ids.length > 0 ? ids : undefined)}
          issues={at('stripFieldIds')}
          disabled={disabled}
        />
      ) : null}
    </>
  );
};
