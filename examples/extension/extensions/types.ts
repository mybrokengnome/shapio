import type { StatsService } from './statsService.ts';

// Typed access to this project's services wherever Shapio hands them out (hooks, routes, jobs).
declare module 'shapio/config' {
  interface CustomServices {
    stats: StatsService;
  }
}
