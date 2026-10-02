import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { BrandMessage } from '@/components/BrandMessage';
import { Button } from '@/components/ui/button';

export const NotFound = () => {
  const { t } = useTranslation();
  return (
    <main id="main" className="flex min-h-svh items-center justify-center bg-background">
      <BrandMessage
        title={t('notFound.title')}
        description={t('notFound.description')}
        actions={
          <Button asChild size="lg">
            <Link to="/">{t('common.backHome')}</Link>
          </Button>
        }
      />
    </main>
  );
};
