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
        message: 'unknown setting "extensions"; allowed: hooks, routes, services, editors, jobs',
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
});
