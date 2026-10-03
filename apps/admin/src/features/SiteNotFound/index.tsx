import { useTranslation } from 'react-i18next';
import { routerBasePath } from '@/app/basePath';
import { BrandMessage } from '@/components/BrandMessage';
import { Button } from '@/components/ui/button';

/**
 * The URL names a site that doesn't exist (deleted, or a mistyped key). "Back home" is a plain link to the
 * admin without a site, so the page loads again for a site the admin works on.
 */
export const SiteNotFound = () => {
  const { t } = useTranslation();
  return (
    <main id="main" className="flex min-h-svh items-center justify-center bg-background">
      <BrandMessage
        title={t('sites.notFound.title')}
        description={t('sites.notFound.description')}
        actions={
          <Button asChild size="lg">
            <a href={`${routerBasePath().replace(/\/$/, '')}/`}>{t('common.backHome')}</a>
          </Button>
        }
      />
    </main>
  );
};
