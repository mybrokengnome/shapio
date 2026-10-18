// @vitest-environment jsdom
import '@/test/dom';
import type { ApiToken } from '@shapio/client';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TokenStatus } from '.';

const NOW = new Date('2026-10-18T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const at = (offset: number) => new Date(NOW.getTime() + offset).toISOString();

const token = (expiresAt: string | null, creatorDisabled = false) =>
  ({ id: 't', expiresAt, creatorDisabled, revokedAt: null }) as ApiToken;

const statusText = (value: ApiToken) => {
  const { container, unmount } = render(<TokenStatus token={value} now={NOW.getTime()} />);
  const parts = [...container.firstElementChild!.children].map((child) => child.textContent);
  const chip = container.querySelector('[data-slot=status-chip]');
  const result = {
    parts,
    tone: chip?.getAttribute('data-tone'),
    title: container.firstElementChild!.getAttribute('title'),
  };
  unmount();
  return result;
};

describe('TokenStatus', () => {
  it('says Active without an expiry', () => {
    expect(statusText(token(null))).toEqual({ parts: ['Active'], tone: 'success', title: null });
  });

  it('says Active with the expiry date under it, and the full date and time in the title', () => {
    const result = statusText(token('2027-01-16T15:30:00.000Z'));
    expect(result.parts).toEqual(['Active', 'Expires Jan 16, 2027']);
    expect(result.tone).toBe('success');
    expect(result.title).toMatch(/^Jan 16, 2027, \d{1,2}:\d{2}\s?[AP]M$/);
  });

  it('warns with the days left within 14 days of expiry', () => {
    expect(statusText(token(at(5 * DAY)))).toMatchObject({ parts: ['Expires in 5 days'], tone: 'warning' });
    expect(statusText(token(at(2 * 60 * 60 * 1000)))).toMatchObject({ parts: ['Expires in 1 day'] });
  });

  it('says Expired, muted, once past its expiry, even when its creator is disabled', () => {
    expect(statusText(token(at(-DAY)))).toMatchObject({ parts: ['Expired'], tone: 'muted' });
    expect(statusText(token(at(-DAY), true))).toMatchObject({ parts: ['Expired'], tone: 'muted' });
  });

  it('says Paused while its creator is disabled, still showing a later expiry', () => {
    expect(statusText(token(null, true))).toMatchObject({
      parts: ['Paused: creator disabled'],
      tone: 'warning',
    });
    expect(statusText(token('2027-01-16T15:30:00.000Z', true)).parts).toEqual([
      'Paused: creator disabled',
      'Expires Jan 16, 2027',
    ]);
  });
});
