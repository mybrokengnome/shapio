import type { Site } from '@shapio/client';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { goToSite } from '@/app/currentSite';
import { RowTitle } from '@/components/RowTitle';
import { TableCard } from '@/components/TableCard';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table as TableRoot,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatDateTime, formatRelativeTime } from '@/helpers/formatDate';

type TableProps = { sites: readonly Site[] };

/** Every site: name (to its page), key, created; "Open" switches the admin to the site. */
export const Table = ({ sites }: TableProps) => {
  const { t } = useTranslation();
  return (
    <TableCard>
      <TableRoot>
        <TableHeader>
          <TableRow>
            <TableHead>{t('sites.name')}</TableHead>
            <TableHead>{t('sites.key')}</TableHead>
            <TableHead>{t('sites.createdAt')}</TableHead>
            <TableHead>
              <span className="sr-only">{t('common.actions')}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sites.map((site) => (
            <TableRow key={site.id}>
              <TableCell>
                <div className="flex items-center gap-2">
                  <RowTitle asChild>
                    <Link to="/network/sites/$siteId" params={{ siteId: site.id }}>
                      {site.name}
                    </Link>
                  </RowTitle>
                  {site.isPrimary ? <Badge variant="secondary">{t('sites.primary')}</Badge> : null}
                </div>
              </TableCell>
              <TableCell className="font-mono text-xs">{site.key}</TableCell>
              <TableCell title={formatDateTime(site.createdAt)}>
                {formatRelativeTime(site.createdAt)}
              </TableCell>
              <TableCell className="text-right">
                <Button
                  variant="outline"
                  size="sm"
                  aria-label={t('sites.openNamed', { name: site.name })}
                  onClick={() => goToSite(site.key)}
                >
                  {t('sites.open')}
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </TableRoot>
    </TableCard>
  );
};
