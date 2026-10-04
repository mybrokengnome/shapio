import type { Locale } from '@shapio/client';
import { Globe, Plus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useLocales, useSetDefaultLocale } from '@/api/locales';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { EmptyState } from '@/components/EmptyState';
import { Page } from '@/components/Page';
import { PageHeader } from '@/components/PageHeader';
import { QueryView } from '@/components/QueryView';
import { Button } from '@/components/ui/button';
import { useNetworkPermission } from '@/features/Network/hooks/useNetworkPermission';
import { useConfirmTarget } from '@/hooks/useConfirmTarget';
import { useDeleteLocaleFlow } from './hooks/useDeleteLocaleFlow';
import { LocaleSheet } from './LocaleSheet';
import { Table } from './Table';

/** Content locales (ADR 0004): code, label, the default locale and each locale's fallback chain. */
export const Locales = () => {
  const { t } = useTranslation();
  const locales = useLocales();
  // Locales are shared by every site: a role granting schema.create on one site doesn't manage them.
  const canManage = useNetworkPermission('schema.create');
  const setDefault = useSetDefaultLocale();
  const makeDefault = useConfirmTarget<Locale>();
  const deletion = useDeleteLocaleFlow();
  const [sheet, setSheet] = useState<{ open: boolean; locale: Locale | undefined }>({
    open: false,
    locale: undefined,
  });
  const currentDefault = locales.data?.find((locale) => locale.isDefault);
  const withContent = deletion.withContent;
  return (
    <Page width="full">
      <PageHeader
        title={t('locales.title')}
        actions={
          canManage ? (
            <Button onClick={() => setSheet({ open: true, locale: undefined })}>
              <Plus aria-hidden="true" />
              {t('locales.add')}
            </Button>
          ) : null
        }
      />
      <QueryView
        query={locales}
        isEmpty={(data) => data.length === 0}
        empty={<EmptyState icon={Globe} title={t('locales.empty')} />}
      >
        {(data) => (
          <Table
            locales={data}
            canManage={canManage}
            onEdit={(locale) => setSheet({ open: true, locale })}
            onMakeDefault={(locale) => {
              setDefault.reset();
              makeDefault.ask(locale);
            }}
            onDelete={deletion.attempt}
          />
        )}
      </QueryView>
      <LocaleSheet
        open={sheet.open}
        onOpenChange={(open) => setSheet((current) => ({ ...current, open }))}
        locale={sheet.locale}
        locales={locales.data ?? []}
      />
      <ConfirmDialog
        open={makeDefault.open}
        onOpenChange={makeDefault.onOpenChange}
        title={t('locales.defaultTitle', { label: makeDefault.target?.label ?? '' })}
        description={t('locales.defaultDescription', {
          label: makeDefault.target?.label ?? '',
          current: currentDefault?.label ?? '',
        })}
        acknowledgement={t('locales.defaultAcknowledge')}
        confirmLabel={t('locales.makeDefault')}
        destructive
        pending={setDefault.isPending}
        pendingLabel={t('common.saving')}
        error={setDefault.error}
        onConfirm={() => {
          const target = makeDefault.target;
          if (target) {
            setDefault.mutate(target.code, {
              onSuccess: () => {
                toast.success(t('locales.defaultChanged', { label: target.label }));
                makeDefault.close();
              },
            });
          }
        }}
      />
      <ConfirmDialog
        open={deletion.open}
        onOpenChange={deletion.onOpenChange}
        title={t('locales.deleteTitle', { label: withContent?.locale.label ?? '' })}
        description={t('locales.deleteContent', {
          count: withContent?.affectedHeads ?? 0,
          label: withContent?.locale.label ?? '',
        })}
        acknowledgement={t('locales.deleteAcknowledge', { count: withContent?.affectedHeads ?? 0 })}
        confirmLabel={t('common.delete')}
        destructive
        pending={deletion.pending}
        pendingLabel={t('locales.deleting')}
        error={deletion.error}
        onConfirm={deletion.confirm}
      />
    </Page>
  );
};
