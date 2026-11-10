import { describe, expect, it } from 'vitest';
import { mcpCommand, TOKEN_PLACEHOLDER } from './cli.js';

const run = async (args: string[], env: Record<string, string> = {}) => {
  let stdout = '';
  let stderr = '';
  const code = await mcpCommand.run(args, {
    stdout: (text) => (stdout += text),
    stderr: (text) => (stderr += text),
    env,
  });
  return { code, stdout, stderr };
};

describe('shapio mcp', () => {
  it('prints every client configuration with a token placeholder, never a token', async () => {
    const { code, stdout } = await run([], { PUBLIC_URL: 'https://cms.example.com/', BASE_PATH: '/cms/' });
    expect(code).toBe(0);
    expect(stdout).toContain('claude mcp add shapio --env SHAPIO_URL=https://cms.example.com/cms --env');
    expect(stdout).toContain(`"SHAPIO_TOKEN=${TOKEN_PLACEHOLDER}" -- npx -y @shapio/mcp`);
    expect(stdout).toContain('Cursor (.cursor/mcp.json');
    expect(stdout).toContain('Claude Desktop');
    expect(stdout).toContain('"SHAPIO_URL": "https://cms.example.com/cms"');
    expect(stdout).toContain('Any MCP client (stdio server)');
    expect(stdout).not.toContain('--allow-ship');
  });

  it('prints one client with --allow-ship, and refuses bad input', async () => {
    const { stdout } = await run(['--client', 'cursor', '--allow-ship', '--url', 'http://127.0.0.1:4400/']);
    expect(stdout).toContain('"--allow-ship"');
    expect(stdout).toContain('"SHAPIO_URL": "http://127.0.0.1:4400"');
    expect(stdout).not.toContain('claude mcp add');
    expect((await run(['--client', 'vim'])).code).toBe(1);
    expect((await run(['--url', 'cms.example.com'])).code).toBe(1);
    expect((await run(['--bogus'])).code).toBe(1);
  });

  it('prints the stdio server definition for any MCP client with --client generic', async () => {
    const { code, stdout } = await run([
      '--client',
      'generic',
      '--allow-ship',
      '--workspace',
      'marketing',
      '--url',
      'https://cms.example.com/',
    ]);
    expect(code).toBe(0);
    expect(stdout).toContain('Any MCP client (stdio server)');
    expect(stdout).not.toContain('mcpServers');
    expect(stdout).not.toContain('claude mcp add');
    const json = stdout.slice(stdout.indexOf('{'), stdout.lastIndexOf('}') + 1);
    expect(JSON.parse(json)).toEqual({
      command: 'npx',
      args: ['-y', '@shapio/mcp', '--allow-ship'],
      env: {
        SHAPIO_URL: 'https://cms.example.com',
        SHAPIO_TOKEN: TOKEN_PLACEHOLDER,
        SHAPIO_SITE: 'marketing',
      },
    });
  });

  it('adds SHAPIO_SITE (read by every @shapio/mcp version) with --workspace, and refuses an invalid key', async () => {
    const { code, stdout } = await run(['--workspace', 'marketing', '--url', 'https://cms.example.com']);
    expect(code).toBe(0);
    expect(stdout).toContain('--env SHAPIO_SITE=marketing -- npx -y @shapio/mcp');
    expect(stdout).toContain('"SHAPIO_SITE": "marketing"');
    expect((await run([])).stdout).not.toContain('SHAPIO_SITE');
    expect((await run(['--workspace', 'Not A Key'])).code).toBe(1);
  });

  it('takes --site too, and SHAPIO_WORKSPACE or SHAPIO_SITE when no flag names one', async () => {
    expect((await run(['--site', 'docs'])).stdout).toContain('"SHAPIO_SITE": "docs"');
    expect((await run([], { SHAPIO_WORKSPACE: 'docs' })).stdout).toContain('"SHAPIO_SITE": "docs"');
    expect((await run([], { SHAPIO_SITE: 'docs' })).stdout).toContain('"SHAPIO_SITE": "docs"');
    expect((await run(['--workspace', 'blog'], { SHAPIO_WORKSPACE: 'docs' })).stdout).toContain(
      '"SHAPIO_SITE": "blog"',
    );
  });

  it('refuses two different workspaces in the flags or in the environment', async () => {
    const flags = await run(['--workspace', 'a', '--site', 'b']);
    expect(flags.code).toBe(1);
    expect(flags.stderr).toBe('--workspace "a" and --site "b" name different workspaces: set one of them\n');
    const env = await run([], { SHAPIO_WORKSPACE: 'a', SHAPIO_SITE: 'b' });
    expect(env.code).toBe(1);
    expect(env.stderr).toContain('SHAPIO_WORKSPACE "a" and SHAPIO_SITE "b"');
  });

  it('documents --workspace only', () => {
    expect(mcpCommand.usage).toContain('--workspace <key>');
    expect(mcpCommand.usage).not.toMatch(/--site\b|\bsites?\b/i);
  });
});
