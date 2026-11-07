import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  resolveWorkspace,
  WORKSPACE_FLAGS,
  workspaceFromFlags,
  type WorkspaceFlagValues,
} from '../../helpers/workspace.js';
import { sha256File, type ImportMap } from '../../import/importMap.js';
import { runMap } from '../../import/mapper.js';
import { checkPlanDirectory, writePlan } from '../../import/planner.js';
import { resolvePlanSite, type PlanSite } from '../../import/planSite.js';
import { formatPlanSummary } from '../../import/summary.js';
import { checkTargetNames } from '../../import/targetNames.js';
import type { ImportSource } from '../../import/types.js';
import type { CliCommand, CliIo } from '../../types.js';
import { DEFAULT_URL, describeFailure, UsageError } from '../export/http.js';
import { resolveSiteKey } from '../schema/sync.js';

/**
 * `shapio import wordpress|strapi`: the two-step importers. `--plan <dir>` reads the export and writes schema
 * files plus `import-map.json`, sending nothing anywhere unless `--url` asks it to check names against an
 * instance; `--map <dir>` (after `shapio schema apply`) uploads media, creates drafts and opens change sets on
 * the instance.
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
      ...WORKSPACE_FLAGS,
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
  if (values.shared && workspaceFromFlags(values) !== undefined) {
    throw new UsageError('Pass either --workspace <key> or --shared, not both');
  }
  return { values, file: positionals[0] };
};

/** The workspace flags among an importer's values (`--workspace`, and `--site`, its older name). */
const workspaceFlagsOf = (values: ImporterValues): WorkspaceFlagValues => ({
  workspace: values.workspace as string | undefined,
  site: values.site as string | undefined,
});

/**
 * The instance `--plan` checks names against: only with an explicit `--url` (SHAPIO_URL alone keeps the plan
 * offline), with `--token` or SHAPIO_TOKEN.
 */
const planConnectionOf = (values: ImporterValues, io: CliIo) => {
  const baseUrl = values.url as string | undefined;
  if (baseUrl === undefined) {
    return undefined;
  }
  const token = (values.token as string | undefined) ?? io.env.SHAPIO_TOKEN;
  if (!token) {
    throw new UsageError(
      '--plan --url checks names on that instance and needs an admin API token: pass --token or set SHAPIO_TOKEN',
    );
  }
  return { baseUrl, token };
};

/**
 * The workspace the plan is for. With an instance and no workspace named, the instance says which (the
 * token's workspace, else the primary workspace) rather than assuming the built-in workspace's key.
 */
const planSiteOf = async (
  requested: PlanSite,
  connection: { baseUrl: string; token: string } | undefined,
): Promise<PlanSite> =>
  connection && !requested.explicit ? { site: await resolveSiteKey(connection), explicit: true } : requested;

/**
 * Where names are checked: the plan's workspace, or for a shared plan none at all, so the instance checks it
 * against the view it answers for (a workspace token's own workspace, never one the token cannot reach).
 */
const planTargetOf = (connection: { baseUrl: string; token: string } | undefined, planSite: PlanSite) =>
  connection && {
    ...connection,
    ...(planSite.site === undefined ? {} : { site: planSite.site }),
    shared: planSite.site === undefined,
  };

const runPlan = async (spec: ImporterSpec, file: string, values: ImporterValues, io: CliIo) => {
  const dir = resolve(String(values.plan));
  const path = resolve(file);
  await checkPlanDirectory(dir, values.force === true);
  const connection = planConnectionOf(values, io);
  const planSite = await planSiteOf(
    resolvePlanSite({ ...workspaceFlagsOf(values), shared: values.shared === true }, io.env),
    connection,
  );
  const target = planTargetOf(connection, planSite);
  const source = await checkTargetNames(await spec.plan(path, dir, values), target);
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
  // `--workspace`, else SHAPIO_WORKSPACE: where `--map` writes (else the workspace the plan recorded).
  const site = resolveWorkspace(workspaceFlagsOf(values), io.env);
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
