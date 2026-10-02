import { Send } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

type PublishOthersAlertProps = {
  /** Other published locales that still serve older shared (non-localized) values. */
  locales: readonly string[];
  labelOf: (code: string) => string;
  /** A publish is running: the action waits for it. */
  publishing: boolean;
  onPublish: (locales: string[]) => void;
  onDismiss: () => void;
};

/**
 * Publishing is per locale (ADR 0004), so other published locales keep their older shared values until
 * they are published too: one action publishes them all, "Not now" hides the notice until the next publish.
 */
export const PublishOthersAlert = ({
  locales,
  labelOf,
  publishing,
  onPublish,
  onDismiss,
}: PublishOthersAlertProps) => {
  const { t } = useTranslation();
  return (
    <Alert variant="warning">
      <AlertDescription className="space-y-2">
        <p>
          {t('content.publishOthers.notice', {
            count: locales.length,
            locales: locales.map(labelOf).join(', '),
          })}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={publishing}
            onClick={() => onPublish([...locales])}
          >
            <Send aria-hidden="true" />
            {t('content.publishOthers.confirm', { count: locales.length })}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={onDismiss}>
            {t('content.publishOthers.notNow')}
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
};
