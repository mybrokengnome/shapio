import { existsSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { createJiti } from 'jiti';
import { describeError } from '../helpers/errors.js';
import { findConfigProblems, type ConfigProblem } from './configSchema.js';
import type { ShapioConfig } from './public.js';

/**
 * Finds and loads the project's `shapio.config.{ts,mts,js,mjs}` (ADR 0009) with jiti, so TypeScript works
 * without a build step (erasable syntax recommended), and validates it. Read once at startup: changing the
 * config or `extensions/` needs a restart, never a rebuild.
 */
export const CONFIG_FILE_NAMES = [
  'shapio.config.ts',
  'shapio.config.mts',
  'shapio.config.js',
  'shapio.config.mjs',
];

export type LoadedProjectConfig = {
  /** The config file, or undefined when the project has none (no extensions). */
  file: string | undefined;
  /** Where `extensions/` lives: the config file's directory, else the search directory. */
  projectDir: string;
  config: ShapioConfig;
};

export class ExtensionConfigError extends Error {
  readonly file: string;
  readonly problems: readonly ConfigProblem[];

  constructor(file: string, problems: readonly ConfigProblem[], options?: ErrorOptions) {
    super(
      `Invalid Shapio config ${file}:\n${problems
        .map((problem) => `  - ${problem.path ? `${problem.path}: ` : ''}${problem.message}`)
        .join('\n')}`,
      options,
    );
    this.name = 'ExtensionConfigError';
    this.file = file;
    this.problems = problems;
  }
}

export type LocateOptions = {
  /** SHAPIO_CONFIG_PATH: an explicit file (it must exist). */
  configPath?: string | undefined;
  /** Searched for a config file when no path is given. Default: the working directory. */
  searchDir?: string;
};

export const locateConfigFile = ({ configPath, searchDir = process.cwd() }: LocateOptions) => {
  if (configPath) {
    const file = resolve(configPath);
    if (!existsSync(file) || !statSync(file).isFile()) {
      throw new ExtensionConfigError(file, [{ path: '', message: 'SHAPIO_CONFIG_PATH points to no file' }]);
    }
    return { file, projectDir: dirname(file) };
  }
  const projectDir = resolve(searchDir);
  const file = CONFIG_FILE_NAMES.map((name) => join(projectDir, name)).find((path) => existsSync(path));
  return { file, projectDir };
};

/** `file:line:column` of the first stack frame inside the project, when the error came from its code. */
const locationIn = (error: unknown, projectDir: string): string | undefined => {
  const stack = error instanceof Error ? (error.stack ?? '') : '';
  const frame = stack
    .split('\n')
    .map((line) => /\(?((?:file:\/\/)?\/[^():]+):(\d+):(\d+)\)?$/.exec(line.trim()))
    .find((match) => match?.[1] && !match[1].includes('node_modules') && match[1].includes(projectDir));
  return frame
    ? `${relative(projectDir, frame[1]?.replace(/^file:\/\//, '') ?? '')}:${frame[2]}:${frame[3]}`
    : undefined;
};

/**
 * `shapio/config` always resolves to the running Shapio's own contract module: `defineConfig` and
 * `HookError` work even where `shapio` is not installed next to the config (Docker volumes, the repository's
 * examples), and never come from a second, different copy. Source in development, `dist/config.js` when
 * bundled.
 */
const PUBLIC_MODULE = ['./public.ts', './public.js', './config.js']
  .map((candidate) => resolve(import.meta.dirname, candidate))
  .find((path) => existsSync(path));

const importConfigModule = async (file: string, projectDir: string): Promise<unknown> => {
  const jiti = createJiti(import.meta.url, {
    fsCache: false,
    moduleCache: false,
    ...(PUBLIC_MODULE ? { alias: { 'shapio/config': PUBLIC_MODULE } } : {}),
  });
  try {
    const loaded = await jiti.import<{ config?: unknown; default?: unknown }>(file);
    return loaded.config ?? loaded.default;
  } catch (error) {
    const location = locationIn(error, projectDir);
    throw new ExtensionConfigError(
      file,
      [{ path: '', message: `failed to load${location ? ` (${location})` : ''}: ${describeError(error)}` }],
      { cause: error },
    );
  }
};

/** Loads and validates the project config; a project without one gets an empty config. */
export const loadProjectConfig = async (options: LocateOptions = {}): Promise<LoadedProjectConfig> => {
  const { file, projectDir } = locateConfigFile(options);
  if (!file) {
    return { file: undefined, projectDir, config: {} };
  }
  const exported = await importConfigModule(file, projectDir);
  const problems = findConfigProblems(exported);
  if (problems.length > 0) {
    throw new ExtensionConfigError(file, problems);
  }
  return { file, projectDir, config: exported as ShapioConfig };
};
