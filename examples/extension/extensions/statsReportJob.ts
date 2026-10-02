import type { ExtensionJobHandler } from 'shapio/config';

/** The `ext.statsReport` job: computes the counts in the background; the result is stored on the job. */
export const statsReportJob: ExtensionJobHandler = async ({ services, logger }) => {
  const counts = await services.stats.counts();
  logger.info({ counts }, 'stats report');
  return { counts };
};
