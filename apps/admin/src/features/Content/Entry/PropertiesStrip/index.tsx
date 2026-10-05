import type { DocumentLayout } from '@shapio/schema';
import { useTranslation } from 'react-i18next';
import { useEntryForm } from '@/fields/form/context';
import { stripFieldsFor } from '../helpers/stripFields';
import { PropertyChip } from '../PropertyChip';

type PropertiesStripProps = {
  layout: DocumentLayout;
  /** Opens the settings drawer at the properties. */
  onMore: () => void;
};

/**
 * Notion-style properties under the title: the configured ones, or the first five that have a value
 * (required ones and the SEO group too, see `stripFieldsFor`). "+N more" opens the drawer with all of them.
 */
export const PropertiesStrip = ({ layout, onMore }: PropertiesStripProps) => {
  const { t } = useTranslation();
  const values = useEntryForm((state) => state.values);
  const shown = stripFieldsFor(layout, values);
  const more = layout.properties.length - shown.length;
  if (layout.properties.length === 0) {
    return null;
  }
  return (
    <div
      role="group"
      aria-label={t('entry.properties.title')}
      className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b pb-4"
    >
      {shown.map((field) => (
        <PropertyChip key={field.id} field={field} />
      ))}
      {more > 0 ? (
        <button
          type="button"
          onClick={onMore}
          className="-mx-1.5 rounded-md px-1.5 py-0.5 text-meta text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          {shown.length === 0
            ? t('entry.properties.add', { count: more })
            : t('entry.properties.more', { count: more })}
        </button>
      ) : null}
    </div>
  );
};
