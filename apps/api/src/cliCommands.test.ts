import { describe, expect, it } from 'vitest';
import { COMMANDS, helpText, listedCommands, runCli } from './cliCommands.js';

/**
 * "site" may stay only where it means a website (an exported WordPress or Strapi site), and in the schema
 * folder `sites/<key>/`, whose name is unchanged on disk.
 */
const WEBSITE_PHRASES = [/WordPress site/g, /Strapi site/g];
const conceptSites = (text: string) =>
  WEBSITE_PHRASES.reduce((rest, phrase) => rest.replace(phrase, ''), text).match(
    /(?<!\/)\bsites?\b(?!\/)/gi,
  ) ?? [];

const captured = async (argv: string[]) => {
  let stdout = '';
  let stderr = '';
  const code = await runCli(argv, {
    stdout: (text) => (stdout += text),
    stderr: (text) => (stderr += text),
    env: {},
  });
  return { code, stdout, stderr };
};

describe('shapio help', () => {
  it('lists `workspaces` and leaves the hidden `sites` alias out', async () => {
    const { code, stdout } = await captured(['help']);
    expect(code).toBe(0);
    expect(stdout).toMatch(/^ {2}workspaces +List, create, or make primary workspaces/m);
    expect(stdout).not.toMatch(/^ {2}sites /m);
    expect(COMMANDS.sites?.hidden).toBe(true);
    expect(COMMANDS.sites?.run).toBe(COMMANDS.workspaces?.run);
    expect(listedCommands().map(([name]) => name)).not.toContain('sites');
  });

  it('says workspace, never site, in every listed summary and usage (and the schema and import help)', async () => {
    const texts = [
      helpText(),
      ...listedCommands().flatMap(([, command]) => [command.summary, command.usage]),
    ];
    for (const group of ['schema', 'types']) {
      texts.push((await captured([group, 'help'])).stdout);
    }
    expect(texts.flatMap(conceptSites)).toEqual([]);
    expect(texts.join('\n')).not.toMatch(/--site\b/);
  });

  it('still runs `shapio sites`, with the workspaces usage', async () => {
    const { code, stderr } = await captured(['sites', 'nope']);
    expect(code).toBe(1);
    expect(stderr).toContain('Usage: shapio workspaces list');
  });
});
