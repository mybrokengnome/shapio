import { useTranslation } from 'react-i18next';
import type { RelationTargetInfo } from '../../helpers/relationTargetLabel';

/**
 * The relation editor's button, picker, and create-sheet copy. A model or interface target is named ("Add
 * Author", "Choose Featurable"); any entry, and a new entry of a type chosen in the sheet, say "entry".
 */
export const useRelationCopy = (target: RelationTargetInfo, targetLabel: string) => {
  const { t } = useTranslation();
  const named = target.kind === 'model' || target.kind === 'interface';
  return {
    add: named ? t('content.relation.add', { model: targetLabel }) : t('content.relation.addEntry'),
    choose: named ? t('content.relation.choose', { model: targetLabel }) : t('content.relation.chooseEntry'),
    pickerTitle: named
      ? t('content.relation.chooseTitle', { model: targetLabel })
      : t('content.relation.chooseEntry'),
    createNew:
      target.kind === 'model'
        ? t('content.relation.createNew', { model: targetLabel })
        : t('content.relation.createEntry'),
    createTitle:
      target.kind === 'model'
        ? t('content.relation.createTitle', { model: targetLabel })
        : t('content.relation.newEntry'),
  };
};
