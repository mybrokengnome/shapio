import { describe, expect, it } from 'vitest';
import { matchHooks } from './hooks.js';

describe('matchHooks', () => {
  const byKey = () => undefined;
  const byId = () => undefined;
  const all = () => undefined;

  it('matches by API key, then stable ID, then *, naming each hook after its key', () => {
    const hooks = {
      article: { afterPublish: byKey },
      m_123: { afterPublish: byId },
      '*': { afterPublish: all },
    };
    expect(matchHooks(hooks, { apiKey: 'article', id: 'm_123' }, 'afterPublish')).toEqual([
      { name: 'article.afterPublish', hook: byKey },
      { name: 'm_123.afterPublish', hook: byId },
      { name: '*.afterPublish', hook: all },
    ]);
    expect(matchHooks(hooks, { apiKey: 'page', id: 'm_9' }, 'afterPublish')).toEqual([
      { name: '*.afterPublish', hook: all },
    ]);
    expect(matchHooks(hooks, { apiKey: 'article', id: 'm_123' }, 'beforePublish')).toEqual([]);
  });
});
