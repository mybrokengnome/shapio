// @vitest-environment jsdom
import '@/test/dom';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EMPTY_DRAFT } from '../helpers/request';
import { useRequestDrafts } from './useRequestDrafts';

describe('useRequestDrafts', () => {
  it('keeps one draft per operation and an empty one for operations never edited', () => {
    const { result } = renderHook(() => useRequestDrafts());
    expect(result.current.draftOf('listArticle')).toBe(EMPTY_DRAFT);
    expect(result.current.draftOf(undefined)).toBe(EMPTY_DRAFT);
    act(() => result.current.setDraft('listArticle', { ...EMPTY_DRAFT, q: 'hello' }));
    act(() => result.current.setDraft('getArticle', { ...EMPTY_DRAFT, id: 'abc' }));
    expect(result.current.draftOf('listArticle').q).toBe('hello');
    expect(result.current.draftOf('getArticle').id).toBe('abc');
    expect(result.current.draftOf('getHome')).toBe(EMPTY_DRAFT);
  });
});
