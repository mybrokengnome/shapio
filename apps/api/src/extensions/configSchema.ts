import { Type } from 'typebox';
import { Value } from 'typebox/value';
import { AFTER_EVENTS, BEFORE_EVENTS } from '../content/hooks.js';

/**
 * The shape of `shapio.config` (ADR 0009), checked with TypeBox when the file is loaded so a mistake fails
 * startup (and `shapio extensions check`) with the path of every problem instead of surfacing at runtime.
 */
const closed = { additionalProperties: false } as const;
const anyFunction = Type.Function([], Type.Unknown());

/** Route prefixes, service names and job names. */
export const ROUTE_PREFIX_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;
export const SERVICE_NAME_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]{0,62}$/;
export const JOB_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]{0,62}$/;
/** Hook keys are a model API key, a stable model ID, or `*`. */
export const HOOK_MODEL_KEY_PATTERN = /^(\*|[A-Za-z0-9_-]{1,100})$/;
/** Names Shapio's own services use in `services` (a custom service of that name would replace Shapio's). */
export const RESERVED_SERVICE_NAMES: ReadonlySet<string> = new Set([
  'site',
  'forSite',
  'content',
  'media',
  'jobs',
  'logger',
]);

const modelHooksSchema = Type.Object(
  Object.fromEntries([...BEFORE_EVENTS, ...AFTER_EVENTS].map((event) => [event, Type.Optional(anyFunction)])),
  closed,
);

export const shapioConfigSchema = Type.Object(
  {
    hooks: Type.Optional(Type.Record(Type.String(), modelHooksSchema)),
    routes: Type.Optional(Type.Array(Type.Object({ prefix: Type.String(), plugin: anyFunction }, closed))),
    services: Type.Optional(Type.Record(Type.String(), anyFunction)),
    // File names are checked (and missing files reported) by the editor manifest, as before package K.
    editors: Type.Optional(Type.Array(Type.String())),
    jobs: Type.Optional(Type.Record(Type.String(), anyFunction)),
  },
  closed,
);

export type ConfigProblem = { path: string; message: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const TOP_LEVEL_KEYS = Object.keys(shapioConfigSchema.properties);
const HOOK_EVENTS = Object.keys(modelHooksSchema.properties);

/** Names the unknown key and what is allowed in its place. */
const unknownKeyMessage = (path: string): string => {
  const segments = path.split('/').slice(1);
  const key = segments.at(-1) ?? '';
  if (segments.length === 1) {
    return `unknown setting "${key}"; allowed: ${TOP_LEVEL_KEYS.join(', ')}`;
  }
  if (segments[0] === 'hooks' && segments.length === 3) {
    return `unknown hook "${key}"; allowed: ${HOOK_EVENTS.join(', ')}`;
  }
  return `unknown key "${key}"`;
};

const keysOf = (value: unknown): string[] => (isRecord(value) ? Object.keys(value) : []);

/** Rules TypeBox cannot express (key patterns, uniqueness, reserved names); tolerant of a malformed config. */
const findNamingProblems = (config: Record<string, unknown>): ConfigProblem[] => {
  const problems: ConfigProblem[] = [];
  for (const key of keysOf(config.hooks)) {
    if (!HOOK_MODEL_KEY_PATTERN.test(key)) {
      problems.push({ path: `/hooks/${key}`, message: 'must be a model API ID, a model UUID or "*"' });
    }
  }
  const prefixes = new Set<string>();
  (Array.isArray(config.routes) ? (config.routes as unknown[]) : []).forEach((route, index) => {
    if (!isRecord(route) || typeof route.prefix !== 'string') {
      return;
    }
    if (!ROUTE_PREFIX_PATTERN.test(route.prefix)) {
      problems.push({
        path: `/routes/${index}/prefix`,
        message: 'must be lower-case letters, digits and dashes (it becomes /api/ext/<prefix>)',
      });
    } else if (prefixes.has(route.prefix)) {
      problems.push({ path: `/routes/${index}/prefix`, message: `"${route.prefix}" is used twice` });
    }
    prefixes.add(route.prefix);
  });
  for (const name of keysOf(config.services)) {
    if (!SERVICE_NAME_PATTERN.test(name)) {
      problems.push({ path: `/services/${name}`, message: 'must be a JavaScript identifier' });
    } else if (RESERVED_SERVICE_NAMES.has(name)) {
      problems.push({ path: `/services/${name}`, message: `"${name}" is one of Shapio's own services` });
    }
  }
  for (const name of keysOf(config.jobs)) {
    if (!JOB_NAME_PATTERN.test(name)) {
      problems.push({
        path: `/jobs/${name}`,
        message: 'must start with a letter and use letters, digits, ".", "_" or "-"',
      });
    }
  }
  return problems;
};

/** Every problem with a loaded config export, or none. */
export const findConfigProblems = (value: unknown): ConfigProblem[] => {
  if (!isRecord(value)) {
    return [
      { path: '', message: 'the config must be an object (export const config = defineConfig({ ... }))' },
    ];
  }
  const shapeProblems = Value.Check(shapioConfigSchema, value)
    ? []
    : [...Value.Errors(shapioConfigSchema, value)]
        // With `additionalProperties: false` each unknown key is reported on itself and again on its parent.
        .filter((error) => error.keyword !== 'additionalProperties')
        .map((error) => ({
          path: error.instancePath,
          message: error.keyword === 'boolean' ? unknownKeyMessage(error.instancePath) : error.message,
        }));
  return [...shapeProblems, ...findNamingProblems(value)];
};
