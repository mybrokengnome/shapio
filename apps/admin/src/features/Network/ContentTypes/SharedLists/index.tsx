import type { DefinitionListItem } from '@shapio/client';
import { useTranslation } from 'react-i18next';
import { List } from '@/features/Models/List';

/** Shared content types and components, then shared interfaces under their own heading. */
type SharedListsProps = { items: DefinitionListItem[] };

export const SharedLists = ({ items }: SharedListsProps) => {
  const { t } = useTranslation();
  const interfaces = items.filter(({ definition }) => definition.kind === 'interface');
  const others = items.filter(({ definition }) => definition.kind !== 'interface');
  return (
    <>
      {others.length > 0 ? <List items={others} showKind markShared={false} /> : null}
      {interfaces.length > 0 ? (
        <section aria-labelledby="shared-interfaces" className="space-y-3">
          <h2 id="shared-interfaces" className="text-base font-semibold">
            {t('interfaces.title')}
          </h2>
          <List items={interfaces} showKind markShared={false} />
        </section>
      ) : null}
    </>
  );
};
