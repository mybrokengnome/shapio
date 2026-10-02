// Development entry (pnpm dev). Production runs `shapio start` (src/cli.ts).
import { loadConfig } from './config/index.js';
import { runMain } from './helpers/runMain.js';
import { startServer } from './server.js';

runMain(() => startServer(loadConfig()));
