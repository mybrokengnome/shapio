import { useTranslation } from 'react-i18next';
import type { PrincipalFieldRead } from '@/api/usage';

type FieldListProps = { fields: readonly PrincipalFieldRead[]; modelKeyOf: (modelId: string) => string };

/**
 * The fields one reader read, as `model.field`; a model it only ever read whole (no field selection) reads
 * "model (whole model)".
 */
export const FieldList = ({ fields, modelKeyOf }: FieldListProps) => {
  const { t } = useTranslation();
  const byModel = new Map<string, PrincipalFieldRead[]>();
  for (const field of fields) {
    byModel.set(field.modelId, [...(byModel.get(field.modelId) ?? []), field]);
  }
  const parts = [...byModel.entries()].flatMap(([modelId, reads]) => {
    const modelKey = modelKeyOf(modelId);
    return reads.every((read) => read.selection === 'implicit')
      ? [t('develop.live.wholeModel', { model: modelKey })]
      : reads.filter((read) => read.selection === 'explicit').map((read) => `${modelKey}.${read.apiKeyPath}`);
  });
  return (
    <span className="block truncate font-mono text-xs" title={parts.join(', ')}>
      {parts.join(', ')}
    </span>
  );
};
