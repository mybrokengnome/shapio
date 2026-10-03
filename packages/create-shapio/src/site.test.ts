import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { main } from './main.js';
import { ScaffoldError } from './scaffold.js';
import { scaffoldSite } from './site.js';

const temporaryDirectories: string[] = [];
const makeTemp = () => {
  const directory = mkdtempSync(join(tmpdir(), 'create-shapio-site-'));
  temporaryDirectories.push(directory);
  return directory;
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const makeTemplates = () => {
  const templatesDir = makeTemp();
  mkdirSync(join(templatesDir, 'next', 'src'), { recursive: true });
  writeFileSync(
    join(templatesDir, 'next', 'package.json'),
    JSON.stringify({ name: 'example-next', version: '9.9.9', private: true }),
  );
  writeFileSync(join(templatesDir, 'next', 'gitignore'), 'node_modules/\n');
  writeFileSync(join(templatesDir, 'next', 'src', 'page.tsx'), 'export {};\n');
  return templatesDir;
};

describe('scaffoldSite', () => {
  it('copies the template, restores .gitignore and names the project after its directory', () => {
    const root = scaffoldSite({
      directory: join(makeTemp(), 'My Site'),
      site: 'next',
      templatesDir: makeTemplates(),
    });
    expect(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))).toEqual({
      name: 'my-site',
      version: '0.1.0',
      private: true,
    });
    expect(existsSync(join(root, '.gitignore'))).toBe(true);
    expect(existsSync(join(root, 'gitignore'))).toBe(false);
    expect(existsSync(join(root, 'src', 'page.tsx'))).toBe(true);
  });

  it('refuses a non-empty directory and a missing template', () => {
    const occupied = makeTemp();
    writeFileSync(join(occupied, 'existing.txt'), 'x');
    expect(() => scaffoldSite({ directory: occupied, site: 'next', templatesDir: makeTemplates() })).toThrow(
      ScaffoldError,
    );
    expect(() =>
      scaffoldSite({ directory: join(makeTemp(), 'site'), site: 'astro', templatesDir: makeTemplates() }),
    ).toThrow(/template is missing/);
  });
});

describe('create-shapio --site', () => {
  const run = (argv: string[]) => {
    const output = { out: '', err: '' };
    const code = main(argv, {
      out: (text) => (output.out += text),
      err: (text) => (output.err += text),
    });
    return { code, ...output };
  };

  it('rejects an unknown starter', () => {
    const result = run([join(makeTemp(), 'site'), '--site', 'nuxt', '--no-install']);
    expect(result.code).toBe(1);
    expect(result.err).toContain('--site must be one of astro, next, sveltekit');
  });

  it('rejects CMS-only options with --site', () => {
    const result = run([
      join(makeTemp(), 'site'),
      '--site',
      'astro',
      '--database-url',
      'postgres://x',
      '--no-install',
    ]);
    expect(result.code).toBe(1);
    expect(result.err).toContain('not --site');
  });
});
