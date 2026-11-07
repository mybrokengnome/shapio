/**
 * The `shapio` bin's commands (cli.ts runs them). Kept apart from the entry point so the documentation's CLI
 * reference can be generated from these definitions without starting anything.
 */
import { REMOTE_COMMANDS, type CliCommand, type CliIo } from '@shapio/cli';
import { Value } from 'typebox/value';
import { loadConfig } from './config/index.js';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, PERSON_NAME_MAX_LENGTH } from './constants/auth.js';
import { SITE_KEY_PATTERN } from './constants/sites.js';
import { SHAPIO_VERSION } from './constants/version.js';
import { backupDatabase, BackupError } from './db/backup.js';
import { createDb, type Database } from './db/index.js';
import { getPendingMigrations, migrateToLatest } from './db/migrator.js';
import { assertDatabaseReachable } from './db/startupChecks.js';
import { checkExtensions } from './extensions/check.js';
import { AppError } from './helpers/appError.js';
import { probeStatus } from './helpers/healthProbe.js';
import { loopbackUrl } from './helpers/publicUrl.js';
import { generateToken } from './helpers/tokens.js';
import { createLogger } from './logger.js';
import { mcpCommand } from './mcp/cli.js';
import { mediaCommand } from './media/cli.js';
import { EmailSchema, PasswordSchema, PersonNameSchema } from './routes/schemas/adminIdentity.js';
import { startServer } from './server.js';
import { SYSTEM_CLI_ACTOR } from './services/actorContext.js';
import { createAdminDirect } from './services/setup.js';
import { createSite, listAllSites, makePrimarySite } from './services/sites.js';
import { startDedicatedWorker } from './worker.js';

/** Runs until a signal stops the process; the exit code is set by the shutdown handler. */
export const KEEP_RUNNING = -1;

const startCommand: CliCommand = {
  summary: 'Run the API server (and the inline worker unless WORKER_MODE=dedicated)',
  usage: 'shapio start',
  run: async () => {
    await startServer(loadConfig());
    return KEEP_RUNNING;
  },
};

const workerCommand: CliCommand = {
  summary: 'Run the job worker as its own process (for WORKER_MODE=dedicated)',
  usage: 'shapio worker',
  run: async () => {
    await startDedicatedWorker(loadConfig());
    return KEEP_RUNNING;
  },
};

const migrateCommand: CliCommand = {
  summary: 'Apply pending database migrations, then exit',
  usage: 'shapio migrate',
  run: async (_args, io) => {
    const config = loadConfig();
    const db = createDb({
      connectionString: config.database.url,
      poolMax: 2,
      applicationName: 'shapio-migrate',
    });
    try {
      await assertDatabaseReachable(db, config.database.url);
      const results = await migrateToLatest(db, createLogger(config));
      io.stdout(
        results.length === 0 ? 'Database is up to date.\n' : `Applied ${results.length} migration(s).\n`,
      );
      return 0;
    } finally {
      await db.destroy();
    }
  },
};

const backupCommand: CliCommand = {
  summary:
    'Copy a SQLite database to a new file while Shapio runs (backup <file>; PostgreSQL uses pg_dump, MySQL mysqldump)',
  usage: 'shapio backup <file>',
  run: async (args, io) => {
    const [target] = args;
    if (!target) {
      io.stderr('Usage: shapio backup <file>\n');
      return 1;
    }
    const config = loadConfig();
    const db = createDb({
      connectionString: config.database.url,
      poolMax: 2,
      applicationName: 'shapio-backup',
    });
    try {
      await assertDatabaseReachable(db, config.database.url);
      io.stdout(`Backed up the database to ${await backupDatabase(db, target)}\n`);
      return 0;
    } catch (error) {
      if (error instanceof BackupError) {
        io.stderr(`${error.message}\n`);
        return 1;
      }
      throw error;
    } finally {
      await db.destroy();
    }
  },
};

const healthcheckCommand: CliCommand = {
  summary: "Exit 0 if this host's Shapio answers /api/ready (for Docker HEALTHCHECK and process monitors)",
  usage: 'shapio healthcheck',
  run: async (_args, io) => {
    const { server, tls } = loadConfig();
    const url = loopbackUrl(
      { port: server.port, basePath: server.basePath, https: tls.mode !== 'off' },
      '/api/ready',
    );
    const status = await probeStatus(url);
    if (status !== 200) {
      io.stderr(`not ready: ${url} -> ${status === 0 ? 'no response' : String(status)}\n`);
      return 1;
    }
    return 0;
  },
};

const versionCommand: CliCommand = {
  summary: 'Print the Shapio version',
  usage: 'shapio version',
  run: async (_args, io) => {
    io.stdout(`${SHAPIO_VERSION}\n`);
    return 0;
  },
};

const ADMIN_USAGE =
  'shapio admin create --email <email> [--name <name>] [--role <role key, default owner>]\n' +
  '  The password is read from SHAPIO_ADMIN_PASSWORD; without it a strong one is generated and printed once.';

/** `--key value` and `--key=value` options. */
const parseOptions = (args: readonly string[]): Map<string, string> => {
  const options = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    const match = /^--([a-z-]+)(?:=(.*))?$/.exec(args[index] ?? '');
    if (match?.[1]) {
      const value = match[2] ?? args[index + 1];
      if (match[2] === undefined) {
        index += 1;
      }
      options.set(match[1], value ?? '');
    }
  }
  return options;
};

/**
 * The rules Setup and invitations apply (the same TypeBox schemas as their routes), so the CLI cannot create
 * an admin who could never sign in. The name is optional here; when given it follows the same limit.
 */
const invalidAdminInput = (
  email: string,
  name: string | undefined,
  password: string | undefined,
): string | undefined => {
  if (!Value.Check(EmailSchema, email.trim())) {
    return '--email must be an email address (at most 254 characters).';
  }
  if (name !== undefined && !Value.Check(PersonNameSchema, name)) {
    return `--name must be 1 to ${PERSON_NAME_MAX_LENGTH} characters.`;
  }
  if (password !== undefined && !Value.Check(PasswordSchema, password)) {
    return `SHAPIO_ADMIN_PASSWORD must be ${PASSWORD_MIN_LENGTH} to ${PASSWORD_MAX_LENGTH} characters.`;
  }
  return undefined;
};

const adminCommand: CliCommand = {
  summary: 'Create an admin account directly in the database (admin create --email ...)',
  usage: ADMIN_USAGE,
  run: async (args, io) => {
    const [subcommand, ...rest] = args;
    const options = parseOptions(rest);
    const email = options.get('email');
    if (subcommand !== 'create' || !email) {
      io.stderr(`Usage: ${ADMIN_USAGE}\n`);
      return 1;
    }
    const providedPassword = io.env.SHAPIO_ADMIN_PASSWORD;
    const invalid = invalidAdminInput(email, options.get('name'), providedPassword);
    if (invalid) {
      io.stderr(`${invalid}\n`);
      return 1;
    }
    const password = providedPassword ?? generateToken();
    const config = loadConfig();
    const db = createDb({
      connectionString: config.database.url,
      poolMax: 2,
      applicationName: 'shapio-admin',
    });
    try {
      const pending = await getPendingMigrations(db);
      if (pending.length > 0) {
        io.stderr('Database migrations are pending; run `shapio migrate` (or start the server) first.\n');
        return 1;
      }
      await createAdminDirect(db, {
        email,
        name: options.get('name') ?? '',
        password,
        roleKey: options.get('role') ?? 'owner',
      });
      io.stdout(`Created admin ${email.trim().toLowerCase()}.\n`);
      if (providedPassword === undefined) {
        io.stdout(`Generated password (shown once, change it after signing in): ${password}\n`);
      }
      return 0;
    } finally {
      await db.destroy();
    }
  },
};

const WORKSPACES_USAGE =
  'shapio workspaces list\n' +
  'shapio workspaces create --key <key> --name <name>\n' +
  'shapio workspaces make-primary --key <key>\n' +
  '  Lists, creates, or makes primary workspaces directly in the database (workspaces share the admins, roles\n' +
  '  and shared content types; each has its own content types, content, media, tokens and snapshots). Keys are\n' +
  '  lower case and fixed once created. The primary workspace answers requests that name no workspace; making\n' +
  '  another workspace primary takes effect right away, and the former primary can then be deleted once it is\n' +
  '  empty.';

const WORKSPACES_SUBCOMMANDS = ['list', 'create', 'make-primary'] as const;
type WorkspacesSubcommand = (typeof WORKSPACES_SUBCOMMANDS)[number];

const SITE_KEY_RE = new RegExp(SITE_KEY_PATTERN);

const usageError = (io: CliIo) => {
  io.stderr(`Usage: ${WORKSPACES_USAGE}\n`);
  return 1;
};

const runWorkspacesSubcommand = async (
  db: Database,
  subcommand: WorkspacesSubcommand,
  options: Map<string, string>,
  io: CliIo,
) => {
  if (subcommand === 'list') {
    for (const site of await listAllSites(db)) {
      io.stdout(`${site.key}\t${site.name}${site.isPrimary ? '\t(primary)' : ''}\n`);
    }
    return 0;
  }
  const key = options.get('key') ?? '';
  if (subcommand === 'make-primary') {
    if (!SITE_KEY_RE.test(key)) {
      return usageError(io);
    }
    try {
      const site = await makePrimarySite(SYSTEM_CLI_ACTOR, { by: 'key', key }, db);
      io.stdout(`Workspace ${site.key} is now the primary workspace.\n`);
      return 0;
    } catch (error) {
      if (error instanceof AppError && error.code === 'SITE_NOT_FOUND') {
        io.stderr(`No workspace has the key "${key}".\n`);
        return 1;
      }
      throw error;
    }
  }
  const name = options.get('name')?.trim() ?? '';
  if (!SITE_KEY_RE.test(key) || name.length === 0) {
    return usageError(io);
  }
  const site = await createSite(SYSTEM_CLI_ACTOR, { key, name }, db);
  io.stdout(`Created workspace ${site.key} (${site.id}).\n`);
  return 0;
};

const runWorkspaces = async (subcommand: WorkspacesSubcommand, options: Map<string, string>, io: CliIo) => {
  const config = loadConfig();
  const db = createDb({
    connectionString: config.database.url,
    poolMax: 2,
    applicationName: 'shapio-workspaces',
  });
  try {
    if ((await getPendingMigrations(db)).length > 0) {
      io.stderr('Database migrations are pending; run `shapio migrate` (or start the server) first.\n');
      return 1;
    }
    return await runWorkspacesSubcommand(db, subcommand, options, io);
  } finally {
    await db.destroy();
  }
};

const isWorkspacesSubcommand = (value: string | undefined): value is WorkspacesSubcommand =>
  WORKSPACES_SUBCOMMANDS.includes(value as WorkspacesSubcommand);

const workspacesCommand: CliCommand = {
  summary:
    'List, create, or make primary workspaces directly in the database (workspaces list | workspaces create --key ... --name ... | workspaces make-primary --key ...)',
  usage: WORKSPACES_USAGE,
  run: async (args, io) => {
    const [subcommand, ...rest] = args;
    if (!isWorkspacesSubcommand(subcommand)) {
      return usageError(io);
    }
    return runWorkspaces(subcommand, parseOptions(rest), io);
  },
};

/** `shapio sites ...`, the name before 0.8.2: still runs, left out of the help and the CLI reference. */
const sitesCommand: CliCommand = { ...workspacesCommand, hidden: true };

const EXTENSIONS_USAGE =
  'shapio extensions check\n' +
  '  Loads shapio.config (SHAPIO_CONFIG_PATH, else the working directory), validates it and lists its hooks,\n' +
  '  routes, services, jobs and editors. Exits 1 on any problem. Needs no database.';

const extensionsCommand: CliCommand = {
  summary: 'Validate shapio.config and list its hooks, routes, services, jobs and editors (extensions check)',
  usage: EXTENSIONS_USAGE,
  run: async (args, io) => {
    if (args[0] !== 'check') {
      io.stderr(`Usage: ${EXTENSIONS_USAGE}\n`);
      return 1;
    }
    const report = await checkExtensions({ configPath: io.env.SHAPIO_CONFIG_PATH || undefined });
    (report.ok ? io.stdout : io.stderr)(report.text);
    return report.ok ? 0 : 1;
  },
};

const LOCAL_COMMANDS: Readonly<Record<string, CliCommand>> = {
  start: startCommand,
  worker: workerCommand,
  migrate: migrateCommand,
  backup: backupCommand,
  healthcheck: healthcheckCommand,
  version: versionCommand,
  admin: adminCommand,
  media: mediaCommand,
  mcp: mcpCommand,
  workspaces: workspacesCommand,
  sites: sitesCommand,
  extensions: extensionsCommand,
};

/** Every `shapio` command: the server-side ones here and the remote ones from packages/cli. */
export const COMMANDS: Readonly<Record<string, CliCommand>> = { ...LOCAL_COMMANDS, ...REMOTE_COMMANDS };

/** The commands help and the CLI reference list: every one but the hidden older names. */
export const listedCommands = (): Array<[string, CliCommand]> =>
  Object.entries(COMMANDS).filter(([, command]) => command.hidden !== true);

export const helpText = () => {
  const listed = listedCommands();
  const width = Math.max(...listed.map(([name]) => name.length));
  const lines = listed.map(([name, command]) => `  ${name.padEnd(width)}  ${command.summary}`);
  return `shapio ${SHAPIO_VERSION}\n\nUsage: shapio <command> [options]\n\nCommands:\n${lines.join('\n')}\n`;
};

export const runCli = async (argv: readonly string[], io: CliIo): Promise<number> => {
  const [name, ...args] = argv;
  if (!name || name === 'help' || name === '--help' || name === '-h') {
    io.stdout(helpText());
    return 0;
  }
  if (name === '--version' || name === '-v') {
    return versionCommand.run(args, io);
  }
  const command = COMMANDS[name];
  if (!command) {
    io.stderr(`shapio: unknown command "${name}"\n\n${helpText()}`);
    return 1;
  }
  return command.run(args, io);
};
