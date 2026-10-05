import { effectiveTitleField, type ComponentDefinition } from '@shapio/schema';
import { useMemo } from 'react';
import { useMe } from '@/api/auth';
import { useLocales } from '@/api/locales';
import { useSiteSeoDefaults } from '@/api/seo';
import { useEntryForm, useFieldsEnvironment } from '../../form/context';
import { localeChainOf, seoPreviewOf, type SeoPreview } from '../helpers';

export type SeoPreviewWithSlug = SeoPreview & {
  /** The URL line: the site's SEO name (else its admin name) and the entry's slug, when it has one. */
  urlLine: string;
};

/**
 * The search-result preview of an SEO value in the entry being edited: the entry's title and slug from the
 * form, the site's defaults for the locale being edited (through its fallback chain).
 */
export const useSeoPreview = (component: ComponentDefinition, value: unknown): SeoPreviewWithSlug => {
  const { model, locale } = useFieldsEnvironment();
  const defaults = useSiteSeoDefaults();
  const locales = useLocales().data;
  const siteName = useMe().data?.site.name ?? '';
  const titleKey = effectiveTitleField(model)?.apiKey;
  const slugKey = model.fields.find((field) => field.type === 'slug' && !field.deprecated)?.apiKey;
  const fallbackTitle = useEntryForm((state) => (titleKey ? state.values[titleKey] : undefined));
  const slug = useEntryForm((state) => (slugKey ? state.values[slugKey] : undefined));
  return useMemo(() => {
    const preview = seoPreviewOf({
      value,
      component,
      defaults,
      localeChain: localeChainOf(locales ?? [], locale),
      fallbackTitle,
    });
    const host = preview.siteName ?? siteName;
    const urlLine = typeof slug === 'string' && slug !== '' ? `${host} › ${slug}` : host;
    return { ...preview, urlLine };
  }, [value, component, defaults, locales, locale, fallbackTitle, siteName, slug]);
};
