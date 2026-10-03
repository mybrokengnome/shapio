import { useId, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/helpers/cn';
import { Body } from './Body';
import type { EntryPreview } from './hooks/useEntryPreview';
import { useTopBarHeight } from './hooks/useTopBarHeight';
import { Toolbar } from './Toolbar';

type PreviewPaneProps = { preview: EntryPreview; title: string };

/**
 * The site's preview beside the document: the right half of the screen under the top bar on lg and up, the
 * whole screen below it, where "Document" slides the document back in over it (the frame stays loaded). Clicking a field in the
 * frame focuses it in the document; saves re-render the frame.
 */
export const PreviewPane = ({ preview, title }: PreviewPaneProps) => {
  const { t } = useTranslation();
  const headingId = useId();
  const topBarHeight = useTopBarHeight(preview.open);
  if (!preview.open) {
    return null;
  }
  return (
    <section
      aria-labelledby={headingId}
      data-preview-pane
      style={{ '--preview-top': `${topBarHeight}px` } as CSSProperties}
      className={cn(
        'fixed inset-x-0 top-12 bottom-0 z-30 flex flex-col bg-card transition-transform md:bottom-(--statusbar-h)',
        'lg:top-(--preview-top) lg:left-auto lg:w-1/2 lg:border-l',
        preview.documentShown && 'invisible translate-x-full',
      )}
    >
      <Toolbar
        headingId={headingId}
        targets={preview.targets}
        target={preview.target}
        onChooseTarget={preview.chooseTarget}
        siteUrl={preview.siteUrl}
        onReload={preview.frameUrl ? preview.refresh : undefined}
        onShowDocument={preview.showDocument}
        onClose={preview.close}
      />
      <div className="flex min-h-0 flex-1 flex-col overflow-auto">
        <Body
          preview={preview}
          frameTitle={t('entry.preview.frameTitle', { title, site: preview.target?.name ?? '' })}
        />
      </div>
    </section>
  );
};
