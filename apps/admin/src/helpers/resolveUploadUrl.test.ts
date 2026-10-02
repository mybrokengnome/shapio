import type { UploadGrant } from '@shapio/client';
import { describe, expect, it } from 'vitest';
import { resolveUploadUrl } from './resolveUploadUrl';

const grantWithUrl = (url: string): UploadGrant => ({
  grantId: 'g1',
  assetId: 'a1',
  expiresAt: '2026-10-02T00:00:00.000Z',
  maxSizeBytes: 10,
  upload: { method: 'POST', url, fields: {}, fileField: 'file' },
});

describe('resolveUploadUrl', () => {
  it("sends Shapio's own upload route through the admin's API base", () => {
    expect(
      resolveUploadUrl(
        grantWithUrl('http://localhost:4300/cms/api/media/uploads/g1'),
        'http://localhost:5173/cms/',
      ),
    ).toBe('http://localhost:5173/cms/api/media/uploads/g1');
  });

  it('leaves bucket URLs alone', () => {
    expect(
      resolveUploadUrl(grantWithUrl('https://bucket.r2.example.com/media'), 'https://cms.example.com/'),
    ).toBe('https://bucket.r2.example.com/media');
  });
});
