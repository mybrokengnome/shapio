import { relative } from 'node:path';
import type { FastifyBaseLogger } from 'fastify';
import { pino } from 'pino';
import { EXTENSION_JOB_PREFIX, EXTENSION_ROUTE_ROOT } from '../constants/extensions.js';
import { AFTER_EVENTS, BEFORE_EVENTS } from '../content/hooks.js';
import { describeError } from '../helpers/errors.js';
import { buildEditorManifest } from './editorManifest.js';
import { loadProjectConfig, type LocateOptions } from './loader.js';
import { themeContrastWarnings } from './themeContrast.js';

/**
 * `shapio extensions check` (ADR 0009): loads and validates the project config without a database and
 * reports what it registers. Exit code 1 on any problem, so CI catches a broken config before a deploy.
 */
export type ExtensionCheckReport = { ok: boolean; text: string };

const AFTER: ReadonlySet<string> = new Set(AFTER_EVENTS);

/** Collects the editor manifest's complaints (missing files, bad names) instead of printing log lines. */
const collectingLogger = (problems: string[]): FastifyBaseLogger =>
  pino(
    { level: 'error' },
    {
      write: (line: string) => {
        const { msg, file } = JSON.parse(line) as { msg?: string; file?: unknown };
        problems.push(`${msg ?? ''}${typeof file === 'string' ? ` (${file})` : ''}`);
      },
    },
  );

export const checkExtensions = async (options: LocateOptions): Promise<ExtensionCheckReport> => {
  let loaded;
  try {
    loaded = await loadProjectConfig(options);
  } catch (error) {
    return { ok: false, text: `${describeError(error)}\n` };
  }
  if (!loaded.file) {
    return { ok: true, text: `No shapio.config in ${loaded.projectDir}: no extensions.\n` };
  }
  const { config, projectDir } = loaded;
  const editorProblems: string[] = [];
  const editors = buildEditorManifest(projectDir, config.editors ?? [], collectingLogger(editorProblems));
  const hooks = Object.entries(config.hooks ?? {}).flatMap(([key, modelHooks]) =>
    [...BEFORE_EVENTS, ...AFTER_EVENTS]
      .filter((event) => modelHooks[event])
      .map(
        (event) => `${key}.${event} (${AFTER.has(event) ? 'after commit, as a job' : 'in the transaction'})`,
      ),
  );
  const themes = config.themes ?? [];
  const contrastWarnings = themeContrastWarnings(themes);
  const section = (title: string, items: readonly string[]) =>
    `${title} (${items.length})\n${items.map((item) => `  ${item}\n`).join('')}`;
  const text = [
    `Config: ${relative(process.cwd(), loaded.file) || loaded.file}\n`,
    section('Hooks', hooks),
    section(
      'Routes',
      (config.routes ?? []).map((route) => `${EXTENSION_ROUTE_ROOT}/${route.prefix}`),
    ),
    section('Services', Object.keys(config.services ?? {})),
    section(
      'Jobs',
      Object.keys(config.jobs ?? {}).map((name) => `${EXTENSION_JOB_PREFIX}${name}`),
    ),
    section(
      'Editors',
      editors.entries.map((entry) => entry.file),
    ),
    section(
      'Themes',
      themes.map((theme) => `${theme.key} (${theme.name})`),
    ),
    ...(editorProblems.length > 0 ? [section('Problems', editorProblems)] : []),
    // Contrast is a warning: the check still passes.
    ...(contrastWarnings.length > 0 ? [section('Warnings', contrastWarnings)] : []),
  ].join('');
  return { ok: editorProblems.length === 0, text };
};
