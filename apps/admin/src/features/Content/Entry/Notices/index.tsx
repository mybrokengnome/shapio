import type { EntryReferrer } from '@shapio/client';
import type { ModelDefinition } from '@shapio/schema';
import { useTranslation } from 'react-i18next';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ConflictBanner } from '../ConflictBanner';
import { PublishOthersAlert } from '../PublishOthersAlert';
import { ReferencedAlert } from '../ReferencedAlert';

type NoticesProps = {
  conflict: string | undefined;
  reloading: boolean;
  onReload: (keepChanges: boolean) => void;
  /** The locale being started (this entry has no version in it yet). */
  newLocaleLabel: string | undefined;
  referrers: readonly EntryReferrer[];
  models: ReadonlyMap<string, ModelDefinition>;
  onDismissReferrers: () => void;
  /** Other published locales still serving older shared values. */
  outdated: readonly string[];
  labelOf: (code: string) => string;
  publishing: boolean;
  onPublishOthers: (locales: string[]) => void;
  onDismissOthers: () => void;
};

/** What the document needs to tell before anything else: conflicts, a new locale, why it can't be deleted. */
export const Notices = ({
  conflict,
  reloading,
  onReload,
  newLocaleLabel,
  referrers,
  models,
  onDismissReferrers,
  outdated,
  labelOf,
  publishing,
  onPublishOthers,
  onDismissOthers,
}: NoticesProps) => {
  const { t } = useTranslation();
  return (
    <>
      {conflict !== undefined ? (
        <ConflictBanner
          code={conflict}
          busy={reloading}
          onReloadKeepingChanges={() => onReload(true)}
          onDiscard={() => onReload(false)}
        />
      ) : null}
      {newLocaleLabel ? (
        <Alert variant="info">
          <AlertDescription>{t('content.locales.missing', { locale: newLocaleLabel })}</AlertDescription>
        </Alert>
      ) : null}
      {referrers.length > 0 ? (
        <ReferencedAlert referrers={referrers} models={models} onDismiss={onDismissReferrers} />
      ) : null}
      {outdated.length > 0 ? (
        <PublishOthersAlert
          locales={outdated}
          labelOf={labelOf}
          publishing={publishing}
          onPublish={onPublishOthers}
          onDismiss={onDismissOthers}
        />
      ) : null}
    </>
  );
};
