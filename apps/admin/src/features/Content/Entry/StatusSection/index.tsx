import type { AdminEntry, Locale } from '@shapio/client';
import type { ModelDefinition } from '@shapio/schema';
import { Copy, Plus } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { InlineConfirm } from '@/components/InlineConfirm';
import { Button } from '@/components/ui/button';
import { formatDateTime } from '@/helpers/formatDate';
import { EntryStatusChip } from '../../EntryStatusChip';
import { DrawerSection } from '../DrawerSection';
import { LocaleStatusList } from '../LocaleStatusList';

type StatusSectionProps = {
  model: ModelDefinition;
  entry: AdminEntry | null;
  locales: readonly Locale[];
  locale: string | null;
  defaultLocale: string | undefined;
  labelOf: (code: string) => string;
  onLocaleChange: (code: string) => void;
  /** Copies the default locale's localized values into the document. */
  onCopyFromDefault?: () => void | Promise<unknown>;
  /** Copying would replace localized values: ask first. */
  confirmCopy: boolean;
};

type RowProps = { term: string; children: ReactNode };

const Row = ({ term, children }: RowProps) => (
  <div className="flex min-h-8 items-center justify-between gap-3 border-b text-sm last:border-b-0">
    <dt className="text-muted-foreground">{term}</dt>
    <dd className="min-w-0 text-right">{children}</dd>
  </div>
);

/** Where the entry stands: status, when it went live, its locales (with "Start French"), dates. */
export const StatusSection = ({
  model,
  entry,
  locales,
  locale,
  defaultLocale,
  labelOf,
  onLocaleChange,
  onCopyFromDefault,
  confirmCopy,
}: StatusSectionProps) => {
  const { t } = useTranslation();
  const notStarted = entry
    ? locales.filter((item) => !entry.locales.some((state) => state.locale === item.code))
    : [];
  const copyButton = (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={confirmCopy || !onCopyFromDefault ? undefined : () => void onCopyFromDefault()}
    >
      <Copy aria-hidden="true" />
      {t('content.locales.copyFrom', { locale: labelOf(defaultLocale ?? '') })}
    </Button>
  );
  return (
    <DrawerSection id="entry-settings-status" title={t('entry.settings.status')}>
      <dl>
        {entry ? (
          <Row term={t('entry.settings.now')}>
            <EntryStatusChip status={entry.status} size="sm" />
          </Row>
        ) : null}
        {entry && model.draftAndPublish ? (
          <Row term={t('entry.settings.liveSince')}>
            {entry.publishedAt ? formatDateTime(entry.publishedAt) : t('content.form.notPublished')}
          </Row>
        ) : null}
        {entry ? <Row term={t('content.form.created')}>{formatDateTime(entry.createdAt)}</Row> : null}
        {entry ? <Row term={t('content.form.updated')}>{formatDateTime(entry.updatedAt)}</Row> : null}
      </dl>
      {model.localized && locale && entry && locales.length > 1 ? (
        <div className="space-y-2 pt-2">
          <h4 className="text-sm font-semibold">{t('content.locales.statuses')}</h4>
          <LocaleStatusList locales={locales} states={entry.locales} current={locale} />
          {notStarted.map((item) => (
            <Button
              key={item.code}
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onLocaleChange(item.code)}
            >
              <Plus aria-hidden="true" />
              {t('entry.settings.startLocale', { locale: item.label })}
            </Button>
          ))}
        </div>
      ) : null}
      {onCopyFromDefault && defaultLocale ? (
        confirmCopy ? (
          <InlineConfirm
            tone="default"
            title={t('content.locales.copyTitle', { locale: labelOf(defaultLocale) })}
            description={t('content.locales.copyDescription')}
            confirmLabel={t('content.locales.copyConfirm')}
            onConfirm={onCopyFromDefault}
            trigger={copyButton}
          />
        ) : (
          copyButton
        )
      ) : null}
    </DrawerSection>
  );
};
