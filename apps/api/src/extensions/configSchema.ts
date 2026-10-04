import {
  BUILT_IN_THEME_KEYS,
  THEME_BRAND_TOKENS,
  THEME_COLOUR_PATTERN,
  THEME_KEY_PATTERN,
  THEME_SEMANTIC_TOKENS,
  THEME_VARIANTS,
} from '@shapio/schema';
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

/** One theme variant: every UI token, brand tokens optional; values are checked in findThemeProblems. */
const themeTokensSchema = Type.Object(
  {
    ...Object.fromEntries(THEME_SEMANTIC_TOKENS.map((token) => [token, Type.String()])),
    ...Object.fromEntries(THEME_BRAND_TOKENS.map((token) => [token, Type.Optional(Type.String())])),
  },
  closed,
);

const themeSchema = Type.Object(
  {
    key: Type.String(),
    name: Type.String({ minLength: 1, maxLength: 60 }),
    description: Type.Optional(Type.String({ maxLength: 200 })),
    light: Type.Optional(themeTokensSchema),
    dark: Type.Optional(themeTokensSchema),
  },
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
    themes: Type.Optional(Type.Array(themeSchema)),
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
  if (segments[0] === 'themes' && segments.length === 4) {
    return `unknown theme token "${key}"; the tokens are listed in documentation/extensions.md`;
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
  return [...problems, ...findThemeProblems(config.themes)];
};

const BUILT_IN_THEMES: ReadonlySet<string> = new Set(BUILT_IN_THEME_KEYS);

/** Theme keys (pattern, built-in, unique), at least one variant, and colour values (no CSS injection). */
const findThemeProblems = (themes: unknown): ConfigProblem[] => {
  const problems: ConfigProblem[] = [];
  const keys = new Set<string>();
  (Array.isArray(themes) ? (themes as unknown[]) : []).forEach((theme, index) => {
    if (!isRecord(theme)) {
      return;
    }
    const path = `/themes/${index}`;
    if (typeof theme.key === 'string') {
      if (!THEME_KEY_PATTERN.test(theme.key)) {
        problems.push({
          path: `${path}/key`,
          message:
            'must start with a lower-case letter and use lower-case letters, digits and dashes (41 at most)',
        });
      } else if (BUILT_IN_THEMES.has(theme.key)) {
        problems.push({ path: `${path}/key`, message: `"${theme.key}" is a built-in theme` });
      } else if (keys.has(theme.key)) {
        problems.push({ path: `${path}/key`, message: `"${theme.key}" is used twice` });
      }
      keys.add(theme.key);
    }
    if (!THEME_VARIANTS.some((variant) => theme[variant] !== undefined)) {
      problems.push({ path, message: 'needs a light or a dark variant (or both)' });
    }
    for (const variant of THEME_VARIANTS) {
      const tokens = theme[variant];
      for (const [token, value] of Object.entries(isRecord(tokens) ? tokens : {})) {
        if (typeof value === 'string' && !THEME_COLOUR_PATTERN.test(value)) {
          problems.push({
            path: `${path}/${variant}/${token}`,
            message: `"${value}" is not a colour: use #rrggbb, rgb(), hsl(), oklch() or oklab()`,
          });
        }
      }
    }
  });
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
