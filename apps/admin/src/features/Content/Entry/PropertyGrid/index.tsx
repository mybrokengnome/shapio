import type { PropertyGroup } from '@shapio/schema';
import { useTranslation } from 'react-i18next';
import { TopLevelField } from '@/fields/form/TopLevelField';

type PropertyGridProps = { groups: readonly PropertyGroup[] };

/**
 * A model without canvas fields (an author, a tag) is still a document: under the title, its properties as
 * a two-column grid of name and value (Notion-style), grouped by the model's display groups.
 */
export const PropertyGrid = ({ groups }: PropertyGridProps) => {
  const { t } = useTranslation();
  return (
    <section aria-label={t('entry.properties.title')} className="space-y-8" data-property-grid>
      {groups.map((group) => (
        <div key={group.id} className="space-y-4">
          {group.label ? (
            <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              {group.label}
            </h2>
          ) : null}
          <div className="space-y-4">
            {group.fields.map((field) => (
              <TopLevelField key={field.id} field={field} layout="inline" />
            ))}
          </div>
        </div>
      ))}
    </section>
  );
};
