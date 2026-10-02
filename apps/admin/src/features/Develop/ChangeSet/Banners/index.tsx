import type { ChangeSet } from '@shapio/client';
import { Link } from '@tanstack/react-router';
import { AlertTriangle, CheckCircle2, Info, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import type { ShipFlow } from '../hooks/useShipFlow';

const NOTICE_KEYS = {
  NEW_FIELDS_AFTER_SHIP: 'changes.review.notices.newFieldsAfterShip',
} as const;

const isKnownNotice = (notice: string): notice is keyof typeof NOTICE_KEYS => notice in NOTICE_KEYS;

const LINK_CLASSES = 'font-semibold text-link underline-offset-4 hover:underline';

type BannersProps = {
  set: ChangeSet;
  flow: ShipFlow;
  notices: readonly string[];
  /** Point at the Checks tab when an acknowledgement is still missing (hidden on that tab). */
  showAcknowledgementHint: boolean;
};

/** In-place notices above the tabs: shipped (→ snapshot), failed, changed since you looked, and the rest. */
export const Banners = ({ set, flow, notices, showAcknowledgementHint }: BannersProps) => {
  const { t } = useTranslation();
  return (
    <>
      {set.status === 'shipped' && set.shippedSnapshot !== null ? (
        <Alert variant="success" role="status">
          <CheckCircle2 aria-hidden="true" />
          <AlertDescription>
            <p>
              {t('changes.review.shippedIn')}{' '}
              <Link
                to="/snapshots/$seq"
                params={{ seq: String(set.shippedSnapshot) }}
                className={LINK_CLASSES}
              >
                {t('snapshots.version', { seq: set.shippedSnapshot })}
              </Link>
            </p>
          </AlertDescription>
        </Alert>
      ) : null}
      {set.status === 'failed' && set.error && !flow.stale ? (
        <Alert variant="destructive">
          <AlertTriangle aria-hidden="true" />
          <AlertTitle>{t('changes.review.failedTitle')}</AlertTitle>
          <AlertDescription>{set.error.message}</AlertDescription>
        </Alert>
      ) : null}
      {flow.stale ? (
        <Alert variant="warning" className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <RefreshCw className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <div>
              <AlertTitle>{t('changes.review.staleTitle')}</AlertTitle>
              <AlertDescription>{t('changes.review.staleDescription')}</AlertDescription>
            </div>
          </div>
          <Button type="button" size="sm" variant="outline" onClick={() => void flow.refresh()}>
            {t('changes.review.refresh')}
          </Button>
        </Alert>
      ) : null}
      {showAcknowledgementHint && (flow.needsBreaking || flow.needsDestructive) && !flow.acknowledged ? (
        <Alert variant="warning" role="status">
          <AlertTriangle aria-hidden="true" />
          <AlertDescription>
            <p>
              {t('changes.review.acknowledgeInChecks')}{' '}
              <Link
                to="/changes/$changeSetId"
                params={{ changeSetId: set.id }}
                search={{ tab: 'checks' }}
                className={LINK_CLASSES}
              >
                {t('changes.tabs.checks')}
              </Link>
            </p>
          </AlertDescription>
        </Alert>
      ) : null}
      {notices.filter(isKnownNotice).map((notice) => (
        <Alert key={notice} variant="info" role="status">
          <Info aria-hidden="true" />
          <AlertDescription>{t(NOTICE_KEYS[notice])}</AlertDescription>
        </Alert>
      ))}
    </>
  );
};
