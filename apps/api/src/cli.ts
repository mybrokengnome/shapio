#!/usr/bin/env node
import type { CliIo } from '@shapio/cli';
import { KEEP_RUNNING, runCli } from './cliCommands.js';
import { loadEnvFileIfPresent } from './config/index.js';
import { describeError } from './helpers/errors.js';

// Settings come from the environment; a .env in the working directory fills in anything unset.
loadEnvFileIfPresent();
const io: CliIo = {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  env: process.env,
};
runCli(process.argv.slice(2), io)
  .then((code) => {
    if (code !== KEEP_RUNNING) {
      process.exitCode = code;
    }
  })
  .catch((error: unknown) => {
    io.stderr(`shapio: ${describeError(error)}\n`);
    process.exitCode = 1;
  });
