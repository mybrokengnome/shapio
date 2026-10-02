import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { useHasGlobalPermission } from '@/api/auth';
import { Activity } from './Activity';
import { useModelSummaries } from './hooks/useModelSummaries';
import { useShortcuts } from './hooks/useShortcuts';
import { Models } from './Models';
import { SetupSteps } from './SetupSteps';
import { Shortcuts } from './Shortcuts';

/**
 * The rest of the workspace dashboard, a section at the end of the Inbox for admins who run publishing or
 * the team: setup steps while they matter, recent activity, content types and shortcuts. Its numbers
 * (`Stats`) head the Inbox.
 */
export const Dashboard = () => {
  const { t } = useTranslation();
  const headingId = useId();
  const canReadAudit = useHasGlobalPermission('audit.read');
  const modelSummaries = useModelSummaries();
  const shortcuts = useShortcuts(modelSummaries.models);
  return (
    <section aria-labelledby={headingId} className="space-y-6 pt-2">
      <h2 id={headingId} className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {t('inbox.overview')}
      </h2>
      <SetupSteps />
      <div className="grid items-start gap-6 xl:grid-cols-3">
        <div className="min-w-0 space-y-6 xl:col-span-2">
          {canReadAudit ? <Activity /> : null}
          <Models {...modelSummaries} />
        </div>
        <Shortcuts shortcuts={shortcuts} />
      </div>
    </section>
  );
};
