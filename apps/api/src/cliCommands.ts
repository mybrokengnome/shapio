/**
 * The `shapio` bin's commands (cli.ts runs them). Kept apart from the entry point so the documentation's CLI
 * reference can be generated from these definitions without starting anything.
 */
import { REMOTE_COMMANDS, type CliCommand, type CliIo } from '@shapio/cli';
import { loadConfig } from './config/index.js';
import { PASSWORD_MIN_LENGTH } from './constants/auth.js';
import { SITE_KEY_PATTERN } from './constants/sites.js';
import { SHAPIO_VERSION } from './constants/version.js';
import { createDb } from './db/index.js';
import { getPendingMigrations, migrateToLatest } from './db/migrator.js';
import { assertDatabaseReachable } from './db/startupChecks.js';
import { checkExtensions } from './extensions/check.js';
import { probeStatus } from './helpers/healthProbe.js';
import { loopbackUrl } from './helpers/publicUrl.js';
import { generateToken } from './helpers/tokens.js';
import { createLogger } from './logger.js';
import { mcpCommand } from './mcp/cli.js';
import { mediaCommand } from './media/cli.js';
import { startServer } from './server.js';
import { SYSTEM_CLI_ACTOR } from './services/actorContext.js';
import { createAdminDirect } from './services/setup.js';
import { createSite, listAllSites } from './services/sites.js';
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
    if (providedPassword !== undefined && providedPassword.length < PASSWORD_MIN_LENGTH) {
      io.stderr(`SHAPIO_ADMIN_PASSWORD must be at least ${PASSWORD_MIN_LENGTH} characters.\n`);
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

const SITES_USAGE =
  'shapio sites list\n' +
  'shapio sites create --key <key> --name <name>\n' +
  '  Lists or creates sites directly in the database (sites share the schema, admins and roles; each has its\n' +
  '  own content, media, tokens and snapshots). Keys are lower case and fixed once created.';

const SITE_KEY_RE = new RegExp(SITE_KEY_PATTERN);

const runSites = async (subcommand: string | undefined, options: Map<string, string>, io: CliIo) => {
  const config = loadConfig();
  const db = createDb({ connectionString: config.database.url, poolMax: 2, applicationName: 'shapio-sites' });
  try {
    if ((await getPendingMigrations(db)).length > 0) {
      io.stderr('Database migrations are pending; run `shapio migrate` (or start the server) first.\n');
      return 1;
    }
    if (subcommand === 'list') {
      for (const site of await listAllSites(db)) {
        io.stdout(`${site.key}\t${site.name}${site.isPrimary ? '\t(primary)' : ''}\n`);
      }
      return 0;
    }
    const key = options.get('key') ?? '';
    const name = options.get('name')?.trim() ?? '';
    if (!SITE_KEY_RE.test(key) || name.length === 0) {
      io.stderr(`Usage: ${SITES_USAGE}\n`);
      return 1;
    }
    const site = await createSite(SYSTEM_CLI_ACTOR, { key, name }, db);
    io.stdout(`Created site ${site.key} (${site.id}).\n`);
    return 0;
  } finally {
    await db.destroy();
  }
};

const sitesCommand: CliCommand = {
  summary: 'List or create sites directly in the database (sites list | sites create --key ... --name ...)',
  usage: SITES_USAGE,
  run: async (args, io) => {
    const [subcommand, ...rest] = args;
    if (subcommand !== 'list' && subcommand !== 'create') {
      io.stderr(`Usage: ${SITES_USAGE}\n`);
      return 1;
    }
    return runSites(subcommand, parseOptions(rest), io);
  },
};

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
  healthcheck: healthcheckCommand,
  version: versionCommand,
  admin: adminCommand,
  media: mediaCommand,
  mcp: mcpCommand,
  sites: sitesCommand,
  extensions: extensionsCommand,
};

/** Every `shapio` command: the server-side ones here and the remote ones from packages/cli. */
export const COMMANDS: Readonly<Record<string, CliCommand>> = { ...LOCAL_COMMANDS, ...REMOTE_COMMANDS };

export const helpText = () => {
  const width = Math.max(...Object.keys(COMMANDS).map((name) => name.length));
  const lines = Object.entries(COMMANDS).map(
    ([name, command]) => `  ${name.padEnd(width)}  ${command.summary}`,
  );
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
