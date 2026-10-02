// Programmatic entry for the `shapio` package. Most users run the `shapio` bin instead.
export { buildApp, type AppDependencies } from './app.js';
export { loadConfig, type AppConfig } from './config/index.js';
export { startServer, type RunningServer } from './server.js';
export { startDedicatedWorker } from './worker.js';
export { SHAPIO_VERSION } from './constants/version.js';
// Project extensions (shapio.config); also importable on their own from `shapio/config`.
export * from './extensions/public.js';
