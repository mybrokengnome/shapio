import type { ResolvedField } from '@shapio/schema';
import { Trans, useTranslation } from 'react-i18next';
import { TextLink } from '@/components/TextLink';
import { useDefinitionDraftStore } from '@/stores/definitionDraft';
import { useModelIndex } from '../../../hooks/useModelIndex';
import { Row } from './Row';

type InheritedProps = {
  /** The draft's inherited fields, ancestors' first, each with the model that declares it. */
  fields: readonly ResolvedField[];
  showLocalized: boolean;
};

type Block = { ownerId: string; fields: ResolvedField[] };

/** Consecutive fields declared by the same ancestor, in order (root first). */
const blocksOf = (fields: readonly ResolvedField[]): Block[] =>
  fields.reduce<Block[]>((blocks, field) => {
    const ownerId = field.inheritedFrom ?? '';
    const last = blocks.at(-1);
    if (last?.ownerId === ownerId) {
      last.fields.push(field);
    } else {
      blocks.push({ ownerId, fields: [field] });
    }
    return blocks;
  }, []);

/**
 * The fields a kind inherits, above its own: one locked block per ancestor that declares them, headed
 * "Inherited from Products" with a link to that type's Structure tab, where they are edited.
 */
export const Inherited = ({ fields, showLocalized }: InheritedProps) => {
  const { t } = useTranslation();
  const { index } = useModelIndex();
  const selection = useDefinitionDraftStore((state) => state.selection);
  const select = useDefinitionDraftStore((state) => state.select);
  if (fields.length === 0) {
    return null;
  }
  return (
    <div className="space-y-2 border-b pb-2">
      {blocksOf(fields).map(({ ownerId, fields: declared }) => {
        const owner = index.get(ownerId)?.label ?? ownerId;
        const headingId = `inherited-from-${ownerId}`;
        return (
          <section key={ownerId} aria-labelledby={headingId}>
            <h3 id={headingId} className="px-3 pt-1 pb-1 text-meta text-muted-foreground">
              <Trans
                i18nKey="models.inheritance.inheritedFromLink"
                values={{ model: owner }}
                components={{ modelLink: <TextLink to="/models/$modelId" params={{ modelId: ownerId }} /> }}
              />
            </h3>
            <ol className="space-y-0.5" aria-label={t('models.inheritance.inheritedFrom', { model: owner })}>
              {declared.map((field) => (
                <Row
                  key={field.id}
                  field={field}
                  selected={selection.type === 'field' && selection.fieldId === field.id}
                  showLocalized={showLocalized}
                  onSelect={() => select({ type: 'field', fieldId: field.id })}
                />
              ))}
            </ol>
          </section>
        );
      })}
    </div>
  );
};
