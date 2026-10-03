import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SITE_STARTERS } from '../starters.js';
import { listFiles } from './files.js';
import { TemplateError } from './rewrite.js';
import { packTemplates, templatePath } from './index.js';

const temporaryDirectories: string[] = [];
const makeTemp = () => {
  const directory = mkdtempSync(join(tmpdir(), 'create-shapio-pack-'));
  temporaryDirectories.push(directory);
  return directory;
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const write = (root: string, path: string, content: string) => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
};

/** A miniature repository: workspace config, one workspace package, the shared assets and three starters. */
const makeRepo = () => {
  const root = makeTemp();
  write(root, 'pnpm-workspace.yaml', 'packages:\n  - packages/*\ncatalog:\n  typescript: 6.0.3\n');
  write(root, 'packages/client/package.json', JSON.stringify({ name: '@shapio/client', version: '1.2.3' }));
  write(root, 'apps/.keep', '');
  write(root, 'examples/shared/package.json', '{}');
  write(root, 'examples/shared/shapio/models/article.json', '{"apiKey":"article"}');
  write(root, 'examples/shared/scripts/seed.ts', "import './lib/admin.js';\n");
  write(root, 'examples/shared/scripts/lib/admin.ts', 'export {};\n');
  for (const starter of SITE_STARTERS) {
    write(
      root,
      `examples/${starter}/package.json`,
      JSON.stringify({
        name: `example-${starter}`,
        scripts: { seed: 'node --import tsx ../shared/scripts/seed.ts' },
        dependencies: { '@shapio/client': 'workspace:*' },
        devDependencies: { typescript: 'catalog:' },
      }),
    );
    write(
      root,
      `examples/${starter}/tsconfig.json`,
      '{\n  "compilerOptions": {\n    "customConditions": ["@shapio/source"]\n  }\n}\n',
    );
    write(root, `examples/${starter}/.gitignore`, 'node_modules/\n');
    write(root, `examples/${starter}/.env.example`, 'SHAPIO_URL=\n');
    write(root, `examples/${starter}/.env`, 'SHAPIO_DELIVERY_TOKEN=secret\n');
    write(root, `examples/${starter}/scripts/smoke.ts`, "import '../../shared/scripts/lib/admin.js';\n");
    write(root, `examples/${starter}/node_modules/x/index.js`, '');
    write(root, `examples/${starter}/dist/index.html`, '');
    write(root, `examples/${starter}/tsconfig.tsbuildinfo`, '');
  }
  return root;
};

describe('listFiles', () => {
  it('skips dependencies, build output, local settings and build info at any depth', () => {
    const root = makeRepo();
    expect(listFiles(join(root, 'examples/next'))).toEqual([
      '.env.example',
      '.gitignore',
      'package.json',
      'scripts/smoke.ts',
      'tsconfig.json',
    ]);
  });
});

describe('packTemplates', () => {
  it('writes each starter plus the shared files as a standalone project', () => {
    const root = makeRepo();
    const outDir = join(root, 'out');
    expect(packTemplates({ repoRoot: root, outDir })).toEqual({ astro: 8, next: 8, sveltekit: 8 });
    const next = join(outDir, 'next');
    expect(listFiles(next).sort()).toEqual(
      [
        '.env.example',
        'gitignore',
        'package.json',
        'scripts/lib/admin.ts',
        'scripts/seed.ts',
        'scripts/smoke.ts',
        'shapio/models/article.json',
        'tsconfig.json',
      ].sort(),
    );
    expect(JSON.parse(readFileSync(join(next, 'package.json'), 'utf8'))).toMatchObject({
      scripts: { seed: 'node --import tsx scripts/seed.ts' },
      dependencies: { '@shapio/client': '^1.2.3' },
      devDependencies: { typescript: '6.0.3' },
    });
    expect(readFileSync(join(next, 'scripts/smoke.ts'), 'utf8')).toBe("import './lib/admin.js';\n");
    expect(readFileSync(join(next, 'tsconfig.json'), 'utf8')).not.toContain('customConditions');
  });

  it('starts from scratch on every run', () => {
    const root = makeRepo();
    const outDir = join(root, 'out');
    write(outDir, 'astro/stale.txt', '');
    packTemplates({ repoRoot: root, outDir });
    expect(readdirSync(join(outDir, 'astro'))).not.toContain('stale.txt');
  });

  it('refuses a file that still points into the repository after packing', () => {
    const root = makeRepo();
    write(root, 'examples/astro/README.md', 'Run node ../shared/scripts/seed.ts');
    expect(() => packTemplates({ repoRoot: root, outDir: join(root, 'out') })).toThrow(TemplateError);
  });

  it('carries .gitignore under a name npm publishes', () => {
    expect(templatePath('.gitignore')).toBe('gitignore');
    expect(templatePath('src/.gitignore')).toBe('src/.gitignore');
  });
});
