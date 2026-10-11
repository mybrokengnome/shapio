#!/usr/bin/env node
import { unsupportedNodeMessage } from './helpers/nodeVersion.js';

// Checked before the real CLI loads: its imports (node:sqlite among them) crash on older Node.js
// before any Shapio code could explain why.
const refusal = unsupportedNodeMessage(process.versions.node, 'shapio');
if (refusal) {
  process.stderr.write(`${refusal}\n`);
  process.exit(1);
}
await import('./cliMain.js');
