import { describe, expect, it } from 'vitest';
import {
  findRepositoryMarkers,
  rewritePackageJson,
  rewriteScriptSource,
  rewriteTsconfig,
  TemplateError,
} from './rewrite.js';

const VERSIONS = {
  workspace: { '@shapio/client': '0.4.2', '@shapio/local': '0.4.2' },
  catalog: { next: '16.3.8', typescript: '6.0.3' },
};

describe('rewritePackageJson', () => {
  it('resolves workspace and catalog specs, points scripts at scripts/ and drops the license', () => {
    const rewritten = rewritePackageJson(
      {
        name: 'example-next',
        license: 'Apache-2.0',
        scripts: {
          seed: 'node --import tsx ../shared/scripts/seed.ts',
          build: 'next build',
        },
        dependencies: {
          '@shapio/client': 'workspace:*',
          '@shapio/local': 'workspace:*',
          next: 'catalog:',
          zod: '^4.0.0',
        },
        devDependencies: { typescript: 'catalog:' },
      },
      VERSIONS,
    );
    expect(rewritten).toEqual({
      name: 'example-next',
      scripts: { seed: 'node --import tsx scripts/seed.ts', build: 'next build' },
      // @shapio/local must run the server's exact release.
      dependencies: { '@shapio/client': '^0.4.2', '@shapio/local': '0.4.2', next: '16.3.8', zod: '^4.0.0' },
      devDependencies: { typescript: '6.0.3' },
    });
    expect(findRepositoryMarkers(JSON.stringify(rewritten))).toEqual([]);
  });

  it.each([
    [{ dependencies: { '@shapio/unknown': 'workspace:*' } }, /no workspace package/],
    [{ dependencies: { svelte: 'catalog:' } }, /no entry for it/],
    [{ devDependencies: { react: 'catalog:react19' } }, /named catalogs/],
  ])('refuses a spec it cannot resolve: %j', (packageJson, message) => {
    expect(() => rewritePackageJson(packageJson, VERSIONS)).toThrow(TemplateError);
    expect(() => rewritePackageJson(packageJson, VERSIONS)).toThrow(message);
  });
});

describe('rewriteScriptSource', () => {
  it('points imports of shared scripts at the project’s own scripts/', () => {
    expect(rewriteScriptSource("import { connectAdmin } from '../../shared/scripts/lib/admin.js';")).toBe(
      "import { connectAdmin } from './lib/admin.js';",
    );
  });
});

describe('rewriteTsconfig', () => {
  it('drops customConditions wherever it sits and keeps the layout', () => {
    const middle =
      '{\n  "compilerOptions": {\n    "strict": true,\n    "customConditions": ["@shapio/source"],\n    "jsx": "react-jsx"\n  }\n}\n';
    expect(rewriteTsconfig(middle)).toBe(
      '{\n  "compilerOptions": {\n    "strict": true,\n    "jsx": "react-jsx"\n  }\n}\n',
    );
    const last =
      '{\n  "compilerOptions": {\n    "strict": true,\n    "customConditions": ["@shapio/source"]\n  }\n}\n';
    expect(rewriteTsconfig(last)).toBe('{\n  "compilerOptions": {\n    "strict": true\n  }\n}\n');
    const first =
      '{\n  "compilerOptions": {\n    "customConditions": ["@shapio/source"],\n    "strict": true\n  }\n}\n';
    expect(JSON.parse(rewriteTsconfig(first))).toEqual({ compilerOptions: { strict: true } });
  });

  it('leaves a tsconfig without the option as it is', () => {
    const plain = '{\n  "extends": "./.svelte-kit/tsconfig.json"\n}\n';
    expect(rewriteTsconfig(plain)).toBe(plain);
  });
});
