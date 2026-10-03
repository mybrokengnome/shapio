/**
 * How a starter in examples/ becomes a standalone project: the repository's workspace wiring is replaced by
 * what an npm project uses. Each function is pure, so the rules are unit-tested.
 */
export type PackageJson = Record<string, unknown> & {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

export type VersionSources = {
  /** Versions of the repository's own packages, by name (`workspace:*` → `^<version>`). */
  workspace: Readonly<Record<string, string>>;
  /** pnpm-workspace.yaml's catalog (`catalog:` → the exact version). */
  catalog: Readonly<Record<string, string>>;
};

export class TemplateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TemplateError';
  }
}

/** In the repository the starters run the shared scripts from examples/shared; a project has them in scripts/. */
const SHARED_SCRIPTS_FROM_PACKAGE = '../shared/scripts/';
const SHARED_SCRIPTS_FROM_SCRIPTS = '../../shared/scripts/';

const resolveSpec = (name: string, spec: string, versions: VersionSources): string => {
  if (spec.startsWith('workspace:')) {
    const version = versions.workspace[name];
    if (!version) {
      throw new TemplateError(`${name} is a workspace dependency, but no workspace package has that name`);
    }
    return `^${version}`;
  }
  if (spec === 'catalog:' || spec === 'catalog:default') {
    const version = versions.catalog[name];
    if (!version) {
      throw new TemplateError(`${name} uses catalog:, but pnpm-workspace.yaml's catalog has no entry for it`);
    }
    return version;
  }
  if (spec.startsWith('catalog:')) {
    throw new TemplateError(`${name}: named catalogs (${spec}) are not supported in starters`);
  }
  return spec;
};

const resolveDependencies = (
  dependencies: Record<string, string> | undefined,
  versions: VersionSources,
): Record<string, string> | undefined =>
  dependencies &&
  Object.fromEntries(
    Object.entries(dependencies).map(([name, spec]) => [name, resolveSpec(name, spec, versions)]),
  );

/** The starter's package.json as a standalone project's: resolved versions, scripts pointing at scripts/. */
export const rewritePackageJson = (packageJson: PackageJson, versions: VersionSources): PackageJson => {
  const { license: _license, ...rest } = packageJson;
  const dependencies = resolveDependencies(packageJson.dependencies, versions);
  const devDependencies = resolveDependencies(packageJson.devDependencies, versions);
  return {
    ...rest,
    ...(packageJson.scripts
      ? {
          scripts: Object.fromEntries(
            Object.entries(packageJson.scripts).map(([name, command]) => [
              name,
              command.replaceAll(SHARED_SCRIPTS_FROM_PACKAGE, 'scripts/'),
            ]),
          ),
        }
      : {}),
    ...(dependencies ? { dependencies } : {}),
    ...(devDependencies ? { devDependencies } : {}),
  };
};

/** A starter script importing a shared one (`../../shared/scripts/lib/admin.js`) finds it beside itself. */
export const rewriteScriptSource = (source: string): string =>
  source.replaceAll(SHARED_SCRIPTS_FROM_SCRIPTS, './');

/**
 * Inside the repository, TypeScript reads `@shapio/client` from its source (`customConditions`); a published
 * package has only its build, so the option is dropped from the project's tsconfig.json.
 */
export const rewriteTsconfig = (text: string): string => {
  // Edited as text so the file keeps its layout; the result must still parse.
  const rewritten = text.replace(/,?\s*"customConditions"\s*:\s*\[[^\]]*\]/, '').replace(/\{,/, '{');
  const parsed = JSON.parse(rewritten) as { compilerOptions?: Record<string, unknown> };
  if (parsed.compilerOptions && 'customConditions' in parsed.compilerOptions) {
    throw new TemplateError('tsconfig.json: customConditions could not be removed');
  }
  return rewritten;
};

/** Text left in a project that only makes sense inside the repository: a packing bug if found. */
export const REPOSITORY_ONLY_MARKERS = ['workspace:', 'catalog:', '@shapio/source', '../shared/'] as const;

export const findRepositoryMarkers = (text: string): string[] =>
  REPOSITORY_ONLY_MARKERS.filter((marker) => text.includes(marker));
