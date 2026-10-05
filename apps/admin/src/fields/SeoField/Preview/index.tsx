import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import type { SeoPreviewWithSlug } from '../hooks/useSeoPreview';

type PreviewProps = { preview: SeoPreviewWithSlug; noindex: boolean };

/** How a search result could show the entry: URL line, title (through the site's template), description. */
export const Preview = ({ preview, noindex }: PreviewProps) => {
  const { t } = useTranslation();
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="space-y-2 rounded-lg border bg-muted/40 p-4">
      <h4 id={headingId} className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {t('seo.field.preview')}
      </h4>
      <div className="min-w-0 space-y-0.5">
        <p className="truncate text-meta text-muted-foreground">{preview.urlLine}</p>
        <p className="line-clamp-2 text-base font-semibold break-words text-link">
          {preview.title ?? t('seo.field.noTitle')}
        </p>
        {preview.description ? (
          <p className="line-clamp-3 text-sm break-words text-muted-foreground">{preview.description}</p>
        ) : null}
      </div>
      {noindex ? <p className="text-meta text-warning">{t('seo.field.noindex')}</p> : null}
    </section>
  );
};
