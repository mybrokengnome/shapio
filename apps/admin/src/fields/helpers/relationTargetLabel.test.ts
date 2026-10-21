import { ANY_TARGET, createDefinitionIndex } from '@shapio/schema';
import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';
import { contract, field, id, model } from '../../../../../packages/schema/src/testing/fixtures';
import { readsContentTargets, relationTargetInfoOf, relationTargetLabel } from './relationTargetLabel';

const t = ((key: string) =>
  key === 'content.relation.anyEntry' ? 'Any entry' : key) as unknown as TFunction;

const post = model({ id: id(1), apiKey: 'post', label: 'Post', fields: [field({ apiKey: 'title' })] });
const featurable = contract({ id: id(2), apiKey: 'featurable', label: 'Featurable' });
const models = new Map([[post.id, post]]);
const index = createDefinitionIndex([post, featurable]);

describe('relationTargetInfoOf', () => {
  it('names a readable model by its label', () => {
    const info = relationTargetInfoOf(post.id, models, index);
    expect(info).toEqual({ kind: 'model', model: post });
    expect(relationTargetLabel(info, t)).toBe('Post');
    expect(readsContentTargets(info)).toBe(false);
  });

  it('names an interface from the index', () => {
    const info = relationTargetInfoOf(featurable.id, models, index);
    expect(info).toEqual({ kind: 'interface', id: featurable.id, label: 'Featurable' });
    expect(relationTargetLabel(info, t)).toBe('Featurable');
    expect(readsContentTargets(info)).toBe(true);
  });

  it('calls the * target "Any entry"', () => {
    const info = relationTargetInfoOf(ANY_TARGET, models, index);
    expect(info).toEqual({ kind: 'any' });
    expect(relationTargetLabel(info, t)).toBe('Any entry');
    expect(readsContentTargets(info)).toBe(true);
  });

  it('treats an ID that is neither a readable model nor a known interface as unreadable', () => {
    expect(relationTargetInfoOf(id(9), models, index)).toEqual({ kind: 'unreadable' });
    // Without an index (still loading), an interface is not known yet either.
    const info = relationTargetInfoOf(featurable.id, models, undefined);
    expect(info).toEqual({ kind: 'unreadable' });
    expect(relationTargetLabel(info, t)).toBeUndefined();
  });

  it('never takes a model hidden from the readable registry for an interface', () => {
    const hidden = model({ id: id(3), apiKey: 'secret', label: 'Secret' });
    const withHidden = createDefinitionIndex([post, featurable, hidden]);
    expect(relationTargetInfoOf(hidden.id, models, withHidden)).toEqual({ kind: 'unreadable' });
  });
});
