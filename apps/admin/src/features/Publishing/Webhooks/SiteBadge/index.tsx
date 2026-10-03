import type { Webhook } from '@shapio/client';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';

type SiteBadgeProps = { webhook: Pick<Webhook, 'site'> };

/** "Every site" on a network webhook (it receives every site's events); nothing on this site's own. */
export const SiteBadge = ({ webhook }: SiteBadgeProps) => {
  const { t } = useTranslation();
  return webhook.site === null ? <Badge variant="secondary">{t('sites.everySite')}</Badge> : null;
};
