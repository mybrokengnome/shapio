// @vitest-environment jsdom
import '@/test/dom';
import { createDefinitionIndex } from '@shapio/schema';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useDefinitionDraftStore } from '@/stores/definitionDraft';
import { contract, id, model } from '../../../../../../../../packages/schema/src/testing/fixtures';
import { Summary } from '.';

const linkable = contract({ id: id(1), apiKey: 'linkable', label: 'Linkable' });
const listable = contract({ id: id(2), apiKey: 'listable', label: 'Listable' });
const post = model({ id: id(3), apiKey: 'post', label: 'Post', implements: [listable.id] });
const article = model({
  id: id(4),
  apiKey: 'article',
  label: 'Article',
  extends: post.id,
  implements: [linkable.id],
});
const plain = model({ id: id(5), apiKey: 'plain', label: 'Plain' });

vi.mock('../../../hooks/useModelIndex', () => ({
  useModelIndex: () => ({ index: createDefinitionIndex([linkable, listable, post, article, plain]) }),
}));

const renderWithDraft = (draft: typeof post) => {
  useDefinitionDraftStore.setState({ draft });
  render(<Summary hasIssues={false} />);
};

afterEach(() => {
  useDefinitionDraftStore.getState().reset();
});

describe('Summary', () => {
  it('names the interfaces a type implements', () => {
    renderWithDraft(post);
    expect(screen.getByText('Implements Listable')).toBeTruthy();
  });

  it('says where an inherited one comes from, beside the type it extends', () => {
    renderWithDraft(article);
    expect(screen.getByText('Kind of Post')).toBeTruthy();
    expect(screen.getByText('Implements Listable (via Post), Linkable')).toBeTruthy();
  });

  it('shows nothing about interfaces for a type that implements none', () => {
    renderWithDraft(plain);
    expect(screen.queryByText(/^Implements/)).toBeNull();
  });
});
