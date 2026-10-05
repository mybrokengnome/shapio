import type { Locale } from '@shapio/client';
import { useTranslation } from 'react-i18next';
import { useLocales } from '@/api/locales';
import { useSiteSeo, type SiteSeo } from '@/api/seo';
import { FormTextField } from '@/components/FormTextField';
import { Page } from '@/components/Page';
import { PageHeader } from '@/components/PageHeader';
import { Panel } from '@/components/Panel';
import { QueryView } from '@/components/QueryView';
import { SubmitButton } from '@/components/SubmitButton';
import { FieldGroup } from '@/components/ui/field';
import { UnsavedChangesGuard } from '@/components/UnsavedChangesGuard';
import { DefaultImage } from './DefaultImage';
import { useSeoSettingsForm } from './hooks/useSeoSettingsForm';
import { LocaleTexts } from './LocaleTexts';

type SeoFormProps = { siteSeo: SiteSeo; locales: readonly Locale[] };

const SeoForm = ({ siteSeo, locales }: SeoFormProps) => {
  const { t } = useTranslation();
  const { form, locale, setLocale, imagePrivate, pending, onSubmit } = useSeoSettingsForm(siteSeo, locales);
  const { isDirty } = form.formState;
  return (
    <form noValidate onSubmit={(event) => void onSubmit(event)} className="space-y-6">
      <UnsavedChangesGuard when={isDirty} />
      <LocaleTexts control={form.control} locales={locales} locale={locale} onLocaleChange={setLocale} />
      <Panel title={t('seo.settings.socialTitle')} titleAs="h2">
        <FieldGroup className="max-w-xl">
          <DefaultImage control={form.control} imagePrivate={imagePrivate} />
          <FormTextField
            control={form.control}
            name="twitterHandle"
            label={t('seo.settings.twitterHandle')}
            hint={t('seo.settings.twitterHandleHint')}
            placeholder={t('seo.settings.twitterHandlePlaceholder')}
            autoComplete="off"
          />
        </FieldGroup>
      </Panel>
      <div>
        <SubmitButton pending={pending} pendingLabel={t('common.saving')} disabled={!isDirty || imagePrivate}>
          {t('common.saveChanges')}
        </SubmitButton>
      </div>
    </form>
  );
};

/** Settings → SEO: the current site's search and social defaults (`site.settings`). */
export const Seo = () => {
  const { t } = useTranslation();
  const siteSeo = useSiteSeo();
  const locales = useLocales();
  return (
    <Page width="full">
      <PageHeader title={t('seo.settings.title')} />
      <QueryView query={siteSeo} loadingRows={4}>
        {(seo) => (
          <QueryView query={locales} loadingRows={4}>
            {(list) => <SeoForm siteSeo={seo} locales={list} />}
          </QueryView>
        )}
      </QueryView>
    </Page>
  );
};
