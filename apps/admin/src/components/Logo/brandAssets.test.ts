import { describe, expect, it } from 'vitest';
import horizontalSvg from '@/assets/brand/logo-horizontal.svg?raw';
import markSvg from '@/assets/brand/mark.svg?raw';
import wordmarkSvg from '@/assets/brand/wordmark.svg?raw';
import brandMarkSvg from '../../../../../brand/shapio-mark.svg?raw';
import brandWordmarkSvg from '../../../../../brand/shapio-wordmark.svg?raw';
import faviconSvg from '../../../public/favicon.svg?raw';
import { LETTER_PATHS } from '../Wordmark/letters';
import { MARK_PATH, MARK_S_PATH, MARK_VIEWBOX } from './paths';

const pathData = (svg: string) => [...svg.matchAll(/ d="([^"]+)"/g)].map((match) => match[1]);
const viewBox = (svg: string) => /viewBox="([^"]+)"/.exec(svg)?.[1];

describe('brand assets', () => {
  it('draws the Logo component from the same geometry as mark.svg', () => {
    expect(pathData(markSvg)).toEqual([MARK_S_PATH, MARK_PATH]);
    expect(viewBox(markSvg)).toBe(MARK_VIEWBOX);
  });

  it('draws the Wordmark letters from the same geometry as wordmark.svg', () => {
    expect(pathData(wordmarkSvg)).toEqual([...LETTER_PATHS]);
  });

  it('keeps logo-horizontal.svg and the favicon on the same geometry', () => {
    expect(pathData(horizontalSvg)).toEqual([MARK_S_PATH, MARK_PATH, ...LETTER_PATHS]);
    expect(faviconSvg).toBe(markSvg);
  });

  it('keeps the admin copies identical to the repo-root brand/ files (node brand/build.mjs writes both)', () => {
    expect(markSvg).toBe(brandMarkSvg);
    expect(wordmarkSvg).toBe(brandWordmarkSvg);
  });
});
