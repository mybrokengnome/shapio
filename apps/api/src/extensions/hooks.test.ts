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

  it("runs a parent type's hooks for its kinds, never a kind's hooks for its parent (ADR 0012)", () => {
    const onPost = () => undefined;
    const onGuide = () => undefined;
    const onRootId = () => undefined;
    const hooks = {
      post: { afterUpdate: onPost },
      guide: { afterUpdate: onGuide },
      m_root: { afterUpdate: onRootId },
      '*': { afterUpdate: all },
    };
    const guide = {
      apiKey: 'guide',
      id: 'm_guide',
      ancestors: [
        { apiKey: 'content', id: 'm_root' },
        { apiKey: 'post', id: 'm_post' },
      ],
    };
    expect(matchHooks(hooks, guide, 'afterUpdate')).toEqual([
      { name: 'guide.afterUpdate', hook: onGuide },
      { name: 'post.afterUpdate', hook: onPost },
      { name: 'm_root.afterUpdate', hook: onRootId },
      { name: '*.afterUpdate', hook: all },
    ]);
    const post = { apiKey: 'post', id: 'm_post', ancestors: [{ apiKey: 'content', id: 'm_root' }] };
    expect(matchHooks(hooks, post, 'afterUpdate').map(({ name }) => name)).toEqual([
      'post.afterUpdate',
      'm_root.afterUpdate',
      '*.afterUpdate',
    ]);
  });
});
