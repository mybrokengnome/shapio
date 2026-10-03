import { Link, type ErrorComponentProps } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { hasErrorCode } from '@/api/errors';
import { BrandMessage } from '@/components/BrandMessage';
import { Button } from '@/components/ui/button';
import { SiteNotFound } from '../SiteNotFound';
import { useRetryAndLogRouteError } from './hooks/useRetryAndLogRouteError';

/**
 * The router's default error screen: a route that threw while loading or rendering (a failed code chunk
 * after a deploy, a bug), or a URL naming a site that doesn't exist. In-page query failures use `ErrorState`
 * instead.
 */
export const RouteError = ({ error, reset }: ErrorComponentProps) => {
  const { t } = useTranslation();
  const { retry } = useRetryAndLogRouteError(error, reset);
  if (hasErrorCode(error, 'SITE_NOT_FOUND')) {
    return <SiteNotFound />;
  }
  return (
    <div role="alert" className="flex min-h-full flex-1 items-center justify-center">
      <BrandMessage
        title={t('routeError.title')}
        description={t('routeError.description')}
        actions={
          <>
            <Button variant="outline" size="lg" onClick={retry}>
              {t('common.retry')}
            </Button>
            <Button asChild size="lg">
              <Link to="/" onClick={reset}>
                {t('common.backHome')}
              </Link>
            </Button>
          </>
        }
      />
    </div>
  );
};
