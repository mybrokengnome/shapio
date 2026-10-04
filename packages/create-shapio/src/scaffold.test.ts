import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { scaffoldProject, ScaffoldError, toPackageName } from './scaffold.js';

const temporaryDirectories: string[] = [];
const makeTemp = () => {
  const directory = mkdtempSync(join(tmpdir(), 'create-shapio-'));
  temporaryDirectories.push(directory);
  return directory;
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('scaffoldProject', () => {
  it('writes a runnable project that depends on @shapio/cms', () => {
    const root = scaffoldProject({ directory: join(makeTemp(), 'My CMS'), shapioSpec: '^1.0.0' });

    const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as Record<
      string,
      unknown
    >;
    expect(packageJson).toMatchObject({
      name: 'my-cms',
      dependencies: { '@shapio/cms': '^1.0.0' },
      scripts: { start: 'shapio start' },
    });
    const env = readFileSync(join(root, '.env'), 'utf8');
    expect(env).toContain('DATABASE_URL=postgres://');
    expect(env).toContain('PUBLIC_URL=http://localhost:4300');
    expect(env).toMatch(/^SESSION_SECRET=[A-Za-z0-9_-]{43}$/m);
    expect(readFileSync(join(root, 'ecosystem.config.cjs'), 'utf8')).toContain("exec_mode: 'fork'");
    const projectConfig = readFileSync(join(root, 'shapio.config.ts'), 'utf8');
    expect(projectConfig).toContain('export const config = defineConfig(');
    expect(projectConfig).toContain("from '@shapio/cms/config'");
    expect(projectConfig).not.toContain('export default');
    for (const path of ['extensions/editors/.gitkeep', 'media/.gitkeep', '.gitignore', 'README.md']) {
      expect(existsSync(join(root, path))).toBe(true);
    }
  });

  it('refuses a non-empty directory', () => {
    const directory = makeTemp();
    writeFileSync(join(directory, 'existing.txt'), 'x');
    expect(() => scaffoldProject({ directory, shapioSpec: '^1.0.0' })).toThrow(ScaffoldError);
  });
});

describe('toPackageName', () => {
  it.each([
    ['My CMS', 'my-cms'],
    ['.hidden', 'hidden'],
    ['ok_name', 'ok_name'],
  ])('%s -> %s', (input, expected) => {
    expect(toPackageName(input)).toBe(expected);
  });
});
