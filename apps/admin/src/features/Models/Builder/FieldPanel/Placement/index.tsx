import type { FieldDefinition, ModelDefinition, ValidationIssue } from '@shapio/schema';
import { useTranslation } from 'react-i18next';
import { useDefinitionDraftStore } from '@/stores/definitionDraft';
import { documentPlacementOf, withDocumentPlacement, type PlacementLock } from '../../../helpers/display';
import { issuesUnder } from '../../../helpers/issues';
import { SwitchControl } from '../../controls/SwitchControl';

type PlacementProps = {
  model: ModelDefinition;
  field: FieldDefinition;
  /** All of the draft's issues; the switch shows the ones on this field's `canvasFieldIds` entry. */
  issues: readonly ValidationIssue[];
  disabled: boolean;
};

const LOCK_KEYS = {
  title: 'models.builder.placement.lockedTitle',
  cover: 'models.builder.placement.lockedCover',
  last: 'models.builder.placement.lockedLast',
} as const satisfies Record<PlacementLock, string>;

/**
 * "Show in document": a view over `display.canvasFieldIds` for one field. On, the entry document shows the
 * field under its heading among the blocks; off, it is a property in the strip and the Settings panel.
 */
export const Placement = ({ model, field, issues, disabled }: PlacementProps) => {
  const { t } = useTranslation();
  const update = useDefinitionDraftStore((state) => state.update);
  const { inDocument, lock } = documentPlacementOf(model, field);
  const index = model.display.canvasFieldIds?.indexOf(field.id) ?? -1;
  return (
    <SwitchControl
      id={`field-${field.id}-in-document`}
      label={t('models.builder.placement.label')}
      hint={t('models.builder.placement.hint')}
      description={lock ? t(LOCK_KEYS[lock]) : undefined}
      issues={index === -1 ? [] : issuesUnder(issues, `/display/canvasFieldIds/${index}`)}
      checked={inDocument}
      disabled={disabled || lock !== undefined}
      onChange={(checked) =>
        update((current) =>
          current.kind === 'component' ? current : withDocumentPlacement(current, field.id, checked),
        )
      }
    />
  );
};
