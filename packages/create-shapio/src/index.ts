#!/usr/bin/env node
import { unsupportedNodeMessage } from './nodeVersion.js';

// Checked before the scaffolder loads, so nothing is written or installed on an unsupported Node.js.
const refusal = unsupportedNodeMessage(process.versions.node);
if (refusal) {
  process.stderr.write(`${refusal}\n`);
  process.exit(1);
}
const { main } = await import('./main.js');
process.exitCode = main(process.argv.slice(2), {
  out: (text) => process.stdout.write(text),
  err: (text) => process.stderr.write(text),
});
