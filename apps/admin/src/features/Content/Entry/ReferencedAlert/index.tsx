import type { EntryReferrer } from '@shapio/client';
import type { ModelDefinition } from '@shapio/schema';
import { Link } from '@tanstack/react-router';
import { Link2 } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { shortId } from '@/fields/helpers/titles';

type ReferencedAlertProps = {
  referrers: readonly EntryReferrer[];
  models: ReadonlyMap<string, ModelDefinition>;
  onDismiss: () => void;
};

/**
 * Why an entry can't be deleted (409 ENTRY_REFERENCED): the entries that still link to it, as links. It
 * scrolls into view when it appears, since the side panel sits below the fields on narrow screens.
 */
export const ReferencedAlert = ({ referrers, models, onDismiss }: ReferencedAlertProps) => {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollIntoView({ block: 'nearest' });
  }, []);
  const unique = referrers.filter(
    (referrer, index) => referrers.findIndex((other) => other.entryId === referrer.entryId) === index,
  );
  return (
    <Alert ref={ref} variant="destructive">
      <Link2 aria-hidden="true" />
      <AlertTitle>{t('content.referenced.title')}</AlertTitle>
      <AlertDescription className="space-y-2">
        <p>{t('content.referenced.description')}</p>
        <ul className="space-y-1">
          {unique.map((referrer) => {
            const model = models.get(referrer.modelId);
            return (
              <li key={referrer.entryId}>
                {model ? (
                  <Link
                    to="/content/$modelKey/$entryId"
                    params={{ modelKey: model.apiKey, entryId: referrer.entryId }}
                    search={model.localized ? { locale: referrer.locale } : {}}
                    className="font-semibold underline underline-offset-4"
                  >
                    {t('content.referenced.entry', { model: model.label, id: shortId(referrer.entryId) })}
                  </Link>
                ) : (
                  t('content.referenced.unknown', { id: shortId(referrer.entryId) })
                )}
              </li>
            );
          })}
        </ul>
        <Button type="button" size="sm" variant="outline" onClick={onDismiss}>
          {t('common.close')}
        </Button>
      </AlertDescription>
    </Alert>
  );
};
