// Project configuration for Shapio (ADR 0009). Loaded once at startup with jiti, so TypeScript works without
// a build step; changing this file or anything in ./extensions needs a restart (never a rebuild).
// `@shapio/cms/config` always resolves to the running Shapio's own copy, so this loads wherever Shapio runs.
import { defineConfig } from '@shapio/cms/config';
import { requireArticleCover } from './extensions/articleCover.ts';
import { logPublish } from './extensions/publishLog.ts';
import { sepiaTheme } from './extensions/sepiaTheme.ts';
import { statsReportJob } from './extensions/statsReportJob.ts';
import { statsRoutes } from './extensions/statsRoutes.ts';
import { createStatsService } from './extensions/statsService.ts';

export const config = defineConfig({
  hooks: {
    // By model API ID. A before* hook runs inside the write's transaction and can reject it.
    article: { beforePublish: requireArticleCover },
    // `*` runs for every model. An after* hook runs after commit, as a job.
    '*': { afterPublish: logPublish },
  },
  // Mounted at /api/ext/example.
  routes: [{ prefix: 'example', plugin: statsRoutes }],
  // Constructed once at startup; shared by hooks, routes and jobs.
  services: { stats: createStatsService },
  // Registered as the job type `ext.statsReport`.
  jobs: { statsReport: statsReportJob },
  // Custom field editors built into ./extensions/editors/*.js (see examples/custom-editor).
  editors: [],
  // Admin colour themes, listed after the built-in ones in the theme menu.
  themes: [sepiaTheme],
});
