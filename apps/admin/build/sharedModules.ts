import { createRequire } from 'node:module';
import type { Plugin } from 'vite';

/**
 * Bare specifiers the admin shares with runtime-loaded custom editors (build plan §3.8, ADR 0009).
 * An editor built as an ES module imports these and gets the admin's own instances through the import map,
 * so hooks and context work across the boundary (one React per page).
 */
export const SHARED_SPECIFIERS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@shapio/editor-sdk',
] as const;

type SharedSpecifier = (typeof SHARED_SPECIFIERS)[number];

/** CommonJS packages: named exports are listed explicitly (an ES `export *` cannot see CJS names). */
const CJS_SPECIFIERS: ReadonlySet<SharedSpecifier> = new Set([
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
]);

const VIRTUAL_PREFIX = '\0shapio-shared:';
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

const requireFromAdmin = createRequire(import.meta.url);

const cjsExportNames = (specifier: string): string[] =>
  Object.keys(requireFromAdmin(specifier) as Record<string, unknown>).filter(
    (name) => IDENTIFIER.test(name) && name !== 'default' && name !== '__esModule',
  );

/** Source of the module a shared specifier maps to: a re-export of the package the admin itself uses. */
const sharedModuleSource = (specifier: SharedSpecifier): string => {
  if (!CJS_SPECIFIERS.has(specifier)) {
    return `export * from ${JSON.stringify(specifier)};\n`;
  }
  const names = cjsExportNames(specifier);
  return [
    `import shared from ${JSON.stringify(specifier)};`,
    `export default shared;`,
    ...names.map((name) => `export const ${name} = shared.${name};`),
    '',
  ].join('\n');
};

/** `react-dom/client` → `shared-react-dom-client` (the emitted chunk name). */
const entryName = (specifier: string) => `shared-${specifier.replace(/^@/, '').replace(/[/]/g, '-')}`;

const virtualId = (specifier: string) => `${VIRTUAL_PREFIX}${specifier}`;

const importMapTag = (imports: Record<string, string>) => ({
  tag: 'script',
  attrs: { type: 'importmap' },
  children: JSON.stringify({ imports }),
  injectTo: 'head-prepend' as const,
});

/**
 * Adds one entry chunk per shared specifier and an import map that points each bare specifier at it.
 *
 * Build: each entry re-exports the very module the app bundles, so the app's chunks and the entry share
 * one module instance. URLs in the map are relative and resolve against the `<base href>` the API
 * injects, so one build works under any BASE_PATH. Dev: the map points at Vite's virtual-module URLs,
 * which import the same pre-bundled dependency the app uses.
 */
export const sharedModulesPlugin = (): Plugin => {
  let command: 'build' | 'serve' = 'build';
  let base = '/';
  return {
    name: 'shapio-shared-modules',
    config: (_config, env) => {
      command = env.command;
      if (env.command !== 'build') {
        return undefined;
      }
      return {
        build: {
          rollupOptions: {
            input: {
              index: 'index.html',
              ...Object.fromEntries(SHARED_SPECIFIERS.map((spec) => [entryName(spec), virtualId(spec)])),
            },
            preserveEntrySignatures: 'exports-only',
          },
        },
      };
    },
    configResolved: (config) => {
      base = config.base;
    },
    resolveId: (id) => (id.startsWith(VIRTUAL_PREFIX) ? id : undefined),
    load: (id) => {
      if (!id.startsWith(VIRTUAL_PREFIX)) {
        return undefined;
      }
      const specifier = id.slice(VIRTUAL_PREFIX.length) as SharedSpecifier;
      return sharedModuleSource(specifier);
    },
    transformIndexHtml: {
      order: 'post',
      handler: (_html, context) => {
        if (command === 'serve') {
          const imports = Object.fromEntries(
            SHARED_SPECIFIERS.map((spec) => [spec, `${base}@id/__x00__${virtualId(spec).slice(1)}`]),
          );
          return [importMapTag(imports)];
        }
        const chunks = Object.values(context.bundle ?? {});
        const imports: Record<string, string> = {};
        for (const specifier of SHARED_SPECIFIERS) {
          const chunk = chunks.find(
            (output) =>
              output.type === 'chunk' && output.isEntry && output.facadeModuleId === virtualId(specifier),
          );
          if (!chunk) {
            throw new Error(`shared module chunk for "${specifier}" was not emitted`);
          }
          imports[specifier] = `./${chunk.fileName}`;
        }
        return [importMapTag(imports)];
      },
    },
  };
};
