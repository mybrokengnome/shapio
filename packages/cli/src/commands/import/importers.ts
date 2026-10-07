import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { sha256File, type ImportMap } from '../../import/importMap.js';
import { runMap } from '../../import/mapper.js';
import { checkPlanDirectory, writePlan } from '../../import/planner.js';
import { resolvePlanSite } from '../../import/planSite.js';
import { formatPlanSummary } from '../../import/summary.js';
import type { ImportSource } from '../../import/types.js';
import type { CliCommand, CliIo } from '../../types.js';
import { DEFAULT_URL, describeFailure, UsageError } from '../export/http.js';

/**
 * `shapio import wordpress|strapi`: the two-step importers. `--plan <dir>` reads the export and writes schema
 * files plus `import-map.json`, sending nothing anywhere; `--map <dir>` (after `shapio schema apply`) uploads
 * media, creates drafts and opens change sets on the instance.
 */
export type ImporterValues = Record<string, string | boolean | undefined>;

export type ImporterSpec = {
  /** The subcommand: `wordpress`, `strapi`. */
  name: string;
  /** For messages and change set titles: `WordPress`, `Strapi`. */
  label: string;
  usage: string;
  summary: string;
  /** Importer-specific string options (e.g. `media-dir`, `key`). */
  options: readonly string[];
  /** Reads the export for `--plan`; `dir` is the plan directory (an importer may keep files there). */
  plan: (file: string, dir: string, values: ImporterValues) => Promise<ImportSource>;
  /** Re-reads the source for `--map`. */
  load: (map: ImportMap, dir: string, values: ImporterValues) => Promise<ImportSource>;
};

type Parsed = { values: ImporterValues; file: string | undefined };

const parse = (args: readonly string[], spec: ImporterSpec): Parsed => {
  const { values, positionals } = parseArgs({
    args: [...args],
    options: {
      plan: { type: 'string' },
      map: { type: 'string' },
      force: { type: 'boolean', default: false },
      shared: { type: 'boolean', default: false },
      url: { type: 'string' },
      token: { type: 'string' },
      site: { type: 'string' },
      ...Object.fromEntries(spec.options.map((option) => [option, { type: 'string' as const }])),
    },
    allowPositionals: true,
  });
  if (positionals.length > 1) {
    throw new UsageError('Give at most one export file');
  }
  if ((values.plan === undefined) === (values.map === undefined)) {
    throw new UsageError('Pass either --plan <dir> (with the export file) or --map <dir>');
  }
  if (values.plan !== undefined && !positionals[0]) {
    throw new UsageError('--plan needs the export file');
  }
  if (values.map !== undefined && positionals[0]) {
    throw new UsageError('--map reads the export recorded in the plan: leave the file out');
  }
  if (values.map !== undefined && values.shared) {
    throw new UsageError('--shared is a --plan option: --map imports where the plan put the models');
  }
  if (values.shared && values.site !== undefined) {
    throw new UsageError('Pass either --site <key> or --shared, not both');
  }
  return { values, file: positionals[0] };
};

/** `--site`, else SHAPIO_SITE: the site `--map` writes to (else the site the plan recorded). */
const siteOf = (values: ImporterValues, io: CliIo) =>
  ((values.site as string | undefined) ?? io.env.SHAPIO_SITE)?.trim() || undefined;

const runPlan = async (spec: ImporterSpec, file: string, values: ImporterValues, io: CliIo) => {
  const dir = resolve(String(values.plan));
  const path = resolve(file);
  await checkPlanDirectory(dir, values.force === true);
  const planSite = resolvePlanSite(
    { site: values.site as string | undefined, shared: values.shared === true },
    io.env,
  );
  const source = await spec.plan(path, dir, values);
  const { definitions } = await writePlan(
    dir,
    source,
    { kind: source.kind, path, sha256: await sha256File(path) },
    { force: values.force === true, site: planSite.site },
  );
  io.stdout(formatPlanSummary(source, definitions, dir, spec.name, planSite));
  return 0;
};

const runMapStep = (spec: ImporterSpec, values: ImporterValues, io: CliIo) => {
  const token = (values.token as string | undefined) ?? io.env.SHAPIO_TOKEN;
  if (!token) {
    throw new UsageError('An admin API token is required: pass --token or set SHAPIO_TOKEN');
  }
  const dir = resolve(String(values.map));
  const site = siteOf(values, io);
  return runMap(
    {
      dir,
      baseUrl: (values.url as string | undefined) ?? io.env.SHAPIO_URL ?? DEFAULT_URL,
      token,
      ...(site ? { site } : {}),
      label: spec.label,
      load: (map) => spec.load(map, dir, values),
    },
    io,
  );
};

export const createImporterCommand = (spec: ImporterSpec): CliCommand => ({
  summary: spec.summary,
  usage: spec.usage,
  run: async (args, io) => {
    let parsed: Parsed;
    try {
      parsed = parse(args, spec);
    } catch (error) {
      if (error instanceof UsageError || error instanceof TypeError) {
        io.stderr(`shapio import ${spec.name}: ${error.message}\nUsage: ${spec.usage}\n`);
        return 1;
      }
      throw error;
    }
    try {
      return parsed.file !== undefined && parsed.values.plan !== undefined
        ? await runPlan(spec, parsed.file, parsed.values, io)
        : await runMapStep(spec, parsed.values, io);
    } catch (error) {
      io.stderr(`shapio import ${spec.name}: ${describeFailure(error)}\n`);
      return 1;
    }
  },
});
