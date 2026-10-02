import type { Job } from '@shapio/client';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useJobs, useRetryJob } from '@/api/jobs';
import { QueryView } from '@/components/QueryView';
import { Button } from '@/components/ui/button';

/** Enough to clear a burst of failures; the rest show once these are retried. */
const FAILED_JOBS_LIMIT = 20;

/** The dead jobs, newest first, each with its last error and a Retry button. */
export const List = () => {
  const { t } = useTranslation();
  const jobs = useJobs({ status: 'dead', limit: FAILED_JOBS_LIMIT });
  const retryJob = useRetryJob();
  const retry = (job: Job) =>
    retryJob.mutate(job.id, {
      onSuccess: () => toast.success(t('develop.live.jobRetried', { type: job.type })),
    });
  return (
    <QueryView query={jobs} loadingRows={3}>
      {(data) => (
        <ul aria-label={t('develop.live.failedJobsTitle')} className="mt-3 divide-y border-t">
          {data.items.map((job) => (
            <li key={job.id} className="flex items-start justify-between gap-3 py-2">
              <div className="min-w-0">
                <p className="font-mono text-xs font-semibold">{job.type}</p>
                {job.lastError ? (
                  <p className="line-clamp-2 text-meta text-destructive" title={job.lastError}>
                    {job.lastError}
                  </p>
                ) : null}
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={retryJob.isPending}
                aria-label={t('develop.live.retryJobLabel', { type: job.type })}
                onClick={() => retry(job)}
              >
                {t('develop.live.retryJob')}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </QueryView>
  );
};
