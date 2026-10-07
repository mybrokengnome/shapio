import { REMOTE_COMMANDS, type CliCommand } from '@shapio/cli';
import { COMMANDS } from '../cliCommands.js';

/**
 * Generates documentation/reference/cli.md from the `shapio` command definitions (cliCommands.ts and
 * packages/cli). Command groups whose `help` only prints (schema, types) contribute their full help text.
 * `reference.test.ts` fails when the page and the commands drift apart.
 */
const HELP_GROUPS = new Set(['schema', 'types']);

const captureHelp = async (command: CliCommand): Promise<string> => {
  let text = '';
  await command.run(['help'], {
    stdout: (chunk) => {
      text += chunk;
    },
    stderr: (chunk) => {
      text += chunk;
    },
    env: {},
  });
  return text.trimEnd();
};

const block = (text: string) => ['```text', text, '```'];

export const renderCliReference = async (): Promise<string> => {
  const lines = [
    '# CLI reference',
    '',
    '<!-- Generated from the `shapio` command definitions by `pnpm docs:reference`. Do not edit by hand. -->',
    '',
    'One command, `shapio`, ships with the `@shapio/cms` npm package (and the Docker image). Run it with `npx shapio`',
    'in a project made by `create-shapio`, or `docker compose exec shapio node node_modules/@shapio/cms/dist/cli.js` in',
    'the container. `shapio help` lists the commands.',
    '',
    'Anywhere else (a website repo, a folder holding an export, CI), run it as `npx @shapio/cms`: the package is',
    'scoped, so a bare `npx shapio` finds nothing outside a project that installs it. The arguments are the same.',
    '',
    '- **Server commands** run on the machine that runs Shapio: they read its environment variables (and a `.env`',
    '  in the working directory) and talk to its database directly.',
    '- **Remote commands** talk to a running instance over HTTP, never to its database. They take `--url` (default',
    '  `$SHAPIO_URL`, else `http://localhost:4300`, including any `BASE_PATH`) and `--token` (default',
    '  `$SHAPIO_TOKEN`): an admin API token from Settings → API tokens. They work from a laptop or CI.',
    '',
    'Variables only the CLI reads:',
    '',
    '| Variable | Used by | Meaning |',
    '| --- | --- | --- |',
    '| `SHAPIO_URL` | remote commands | The instance to talk to. |',
    '| `SHAPIO_TOKEN` | remote commands | An admin API token. |',
    '| `SHAPIO_ADMIN_PASSWORD` | `shapio admin create` | The new admin’s password; without it one is generated and printed once. |',
  ];
  const sections: Array<[string, Array<[string, CliCommand]>]> = [
    ['Server commands', Object.entries(COMMANDS).filter(([name]) => !(name in REMOTE_COMMANDS))],
    ['Remote commands', Object.entries(COMMANDS).filter(([name]) => name in REMOTE_COMMANDS)],
  ];
  for (const [title, commands] of sections) {
    lines.push('', `## ${title}`);
    for (const [name, command] of commands) {
      lines.push('', `### shapio ${name}`, '', `${command.summary}.`, '', ...block(command.usage));
      if (HELP_GROUPS.has(name)) {
        lines.push('', ...block(await captureHelp(command)));
      }
    }
  }
  return `${lines.join('\n')}\n`;
};
