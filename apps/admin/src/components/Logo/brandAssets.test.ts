import { describe, expect, it } from 'vitest';
import horizontalSvg from '@/assets/brand/logo-horizontal.svg?raw';
import markSvg from '@/assets/brand/mark.svg?raw';
import wordmarkSvg from '@/assets/brand/wordmark.svg?raw';
import classicLogoSvg from '../../../../../brand/classic-logo.svg?raw';
import classicMarkMonoSvg from '../../../../../brand/classic-mark-mono.svg?raw';
import classicMarkSvg from '../../../../../brand/classic-mark.svg?raw';
import classicWordmarkSvg from '../../../../../brand/classic-wordmark.svg?raw';
import brandLogoSvg from '../../../../../brand/shapio-logo.svg?raw';
import brandMarkMonoSvg from '../../../../../brand/shapio-mark-mono.svg?raw';
import brandMarkSvg from '../../../../../brand/shapio-mark.svg?raw';
import brandWordmarkSvg from '../../../../../brand/shapio-wordmark.svg?raw';
import faviconSvg from '../../../public/favicon.svg?raw';
import { LETTER_PATHS } from '../Wordmark/letters';
import { MARK_PATH, MARK_S_PATH, MARK_VIEWBOX } from './paths';

const pathData = (svg: string) => [...svg.matchAll(/ d="([^"]+)"/g)].map((match) => match[1]);
const viewBox = (svg: string) => /viewBox="([^"]+)"/.exec(svg)?.[1];
const fills = (svg: string) => [...svg.matchAll(/<path fill="([^"]+)"/g)].map((match) => match[1]);

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

  it('keeps the classic (blue) set on the same geometry as the Shapio set: only the fills differ', () => {
    expect(pathData(classicLogoSvg)).toEqual([MARK_PATH, ...LETTER_PATHS]);
    expect(pathData(brandLogoSvg)).toEqual([MARK_S_PATH, MARK_PATH, ...LETTER_PATHS]);
    expect(pathData(classicMarkSvg)).toEqual(pathData(brandMarkSvg));
    expect(pathData(classicMarkMonoSvg)).toEqual(pathData(brandMarkMonoSvg));
    expect(pathData(classicWordmarkSvg)).toEqual(pathData(brandWordmarkSvg));
    expect(viewBox(classicMarkSvg)).toBe(viewBox(brandMarkSvg));
    expect(viewBox(classicWordmarkSvg)).toBe(viewBox(brandWordmarkSvg));
  });

  it('colours the Shapio mark yellow with a plum S, and keeps the classic mark blue with a white S', () => {
    expect(fills(brandMarkSvg)).toEqual(['#231527', '#E9F26E']);
    expect(fills(brandMarkMonoSvg)).toEqual(['#231527']);
    expect(fills(classicMarkSvg)).toEqual(['#FFFFFF', '#2F5BFF']);
    expect(fills(classicMarkMonoSvg)).toEqual(['#0F1B3D']);
  });
});
