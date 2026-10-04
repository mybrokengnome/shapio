import { THEME_SEMANTIC_TOKENS } from '@shapio/schema';
import { describe, expect, it } from 'vitest';
import { findConfigProblems } from './configSchema.js';

const noop = () => undefined;

describe('shapio.config validation', () => {
  it('accepts the full shape and an empty config', () => {
    expect(findConfigProblems({})).toEqual([]);
    expect(
      findConfigProblems({
        hooks: { article: { beforePublish: noop, afterPublish: noop }, '*': { afterDelete: noop } },
        routes: [{ prefix: 'acme-stats', plugin: async () => undefined }],
        services: { stats: noop },
        editors: ['rating.js'],
        jobs: { 'nightly.report': async () => undefined },
      }),
    ).toEqual([]);
  });

  it('names unknown settings and hooks with what is allowed', () => {
    expect(findConfigProblems({ extensions: [], hooks: { article: { beforePublsh: noop } } })).toEqual([
      {
        path: '/extensions',
        message: 'unknown setting "extensions"; allowed: hooks, routes, services, editors, jobs, themes',
      },
      {
        path: '/hooks/article/beforePublsh',
        message:
          'unknown hook "beforePublsh"; allowed: beforeCreate, beforeUpdate, beforePublish, beforeDelete, ' +
          'afterCreate, afterUpdate, afterPublish, afterDelete',
      },
    ]);
  });

  it('reports wrong types, bad names, duplicates and reserved service names together', () => {
    const problems = findConfigProblems({
      hooks: { 'bad key!': { beforeCreate: 'nope' } },
      routes: [
        { prefix: 'Stats', plugin: noop },
        { prefix: 'ok', plugin: noop },
        { prefix: 'ok', plugin: noop },
      ],
      services: { content: noop },
      jobs: { '1st': noop },
    });
    expect(problems.map((problem) => problem.path)).toEqual([
      '/hooks/bad key!/beforeCreate',
      '/hooks/bad key!',
      '/routes/0/prefix',
      '/routes/2/prefix',
      '/services/content',
      '/jobs/1st',
    ]);
  });

  it("reserves the names of Shapio's own services, including site and forSite", () => {
    const problems = findConfigProblems({
      services: { site: noop, forSite: noop, content: noop, media: noop, jobs: noop, logger: noop },
    });
    expect(problems).toEqual(
      ['site', 'forSite', 'content', 'media', 'jobs', 'logger'].map((name) => ({
        path: `/services/${name}`,
        message: `"${name}" is one of Shapio's own services`,
      })),
    );
  });

  it('rejects a config that is not an object', () => {
    expect(findConfigProblems(undefined)).toHaveLength(1);
    expect(findConfigProblems([])).toHaveLength(1);
  });

  describe('themes', () => {
    const tokens = Object.fromEntries(THEME_SEMANTIC_TOKENS.map((token) => [token, '#123456']));
    const theme = { key: 'harbour', name: 'Harbour', dark: tokens };

    it('accepts a theme with one or both variants, brand tokens optional, any colour syntax', () => {
      expect(
        findConfigProblems({
          themes: [
            theme,
            {
              key: 'harbour-day',
              name: 'Harbour day',
              description: 'Light and dark',
              light: { ...tokens, background: 'oklch(97% 0.01 90)', 'brand-letters': '#abc' },
              dark: { ...tokens, overlay: 'rgb(0 0 0 / 0.5)' },
            },
          ],
        }),
      ).toEqual([]);
    });

    it('names an unknown token, a missing token and a value that is not a colour', () => {
      const { foreground: _missing, ...withoutForeground } = tokens;
      const problems = findConfigProblems({
        themes: [
          { ...theme, dark: { ...tokens, backgrund: '#000000' } },
          { ...theme, key: 'harbour-2', dark: withoutForeground },
          { ...theme, key: 'harbour-3', dark: { ...tokens, card: 'red; } body { display: none' } },
        ],
      });
      expect(problems).toContainEqual({
        path: '/themes/0/dark/backgrund',
        message: 'unknown theme token "backgrund"; the tokens are listed in documentation/extensions.md',
      });
      expect(problems.some((problem) => problem.path.startsWith('/themes/1/dark'))).toBe(true);
      expect(problems).toContainEqual({
        path: '/themes/2/dark/card',
        message:
          '"red; } body { display: none" is not a colour: use #rrggbb, rgb(), hsl(), oklch() or oklab()',
      });
    });

    it('refuses a bad key, a built-in key, a duplicate and a theme without variants', () => {
      expect(
        findConfigProblems({
          themes: [
            { ...theme, key: "x'] {" },
            { ...theme, key: 'classic' },
            theme,
            theme,
            { key: 'empty', name: 'Empty' },
          ],
        }),
      ).toEqual([
        {
          path: '/themes/0/key',
          message:
            'must start with a lower-case letter and use lower-case letters, digits and dashes (41 at most)',
        },
        { path: '/themes/1/key', message: '"classic" is a built-in theme' },
        { path: '/themes/3/key', message: '"harbour" is used twice' },
        { path: '/themes/4', message: 'needs a light or a dark variant (or both)' },
      ]);
    });
  });
});
