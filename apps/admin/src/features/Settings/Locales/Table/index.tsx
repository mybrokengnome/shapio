import type { Locale } from '@shapio/client';
import { useTranslation } from 'react-i18next';
import { TableCard } from '@/components/TableCard';
import { Table as TableRoot, TableBody, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Row } from './Row';

type TableProps = {
  locales: readonly Locale[];
  canManage: boolean;
  onEdit: (locale: Locale) => void;
  onMakeDefault: (locale: Locale) => void;
  onDelete: (locale: Locale) => Promise<unknown>;
};

export const Table = ({ locales, canManage, onEdit, onMakeDefault, onDelete }: TableProps) => {
  const { t } = useTranslation();
  const defaultLocale = locales.find((locale) => locale.isDefault);
  return (
    <TableCard>
      <TableRoot>
        <TableHeader>
          <TableRow>
            <TableHead>{t('locales.label')}</TableHead>
            <TableHead>{t('locales.code')}</TableHead>
            <TableHead>{t('locales.fallbacks')}</TableHead>
            <TableHead>
              <span className="sr-only">{t('common.actions')}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {locales.map((locale) => (
            <Row
              key={locale.code}
              locale={locale}
              chain={[
                ...locale.fallbacks,
                ...(defaultLocale && !locale.isDefault && !locale.fallbacks.includes(defaultLocale.code)
                  ? [defaultLocale.code]
                  : []),
              ]}
              canManage={canManage}
              onEdit={onEdit}
              onMakeDefault={onMakeDefault}
              onDelete={onDelete}
            />
          ))}
        </TableBody>
      </TableRoot>
    </TableCard>
  );
};
