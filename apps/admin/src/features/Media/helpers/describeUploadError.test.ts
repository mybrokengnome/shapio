// @vitest-environment jsdom
import '@/test/dom';
import { ShapioApiError } from '@shapio/client';
import { describe, expect, it } from 'vitest';
import { apiBaseUrl } from '@/api/client';
import { UploadTransferError } from '@/helpers/uploadWithProgress';
import { describeUploadError } from './describeUploadError';

const BLOCKED = /^The request was blocked before it reached Shapio \(HTTP 403\)/;
const ownRoute = () => new URL('api/media/uploads/grant-1', apiBaseUrl()).href;

describe('describeUploadError', () => {
  it("says a firewall blocked the bytes when Shapio's upload route answers 403 with HTML", () => {
    expect(describeUploadError(new UploadTransferError(403, '<html>Blocked</html>', ownRoute()))).toMatch(
      BLOCKED,
    );
  });

  it("keeps Shapio's own and the bucket's 403s as storage refusals", () => {
    const shapioBody = '{"error":{"code":"UPLOAD_GRANT_EXPIRED","message":"Expired."}}';
    expect(describeUploadError(new UploadTransferError(403, shapioBody, ownRoute()))).not.toMatch(BLOCKED);
    const bucket = 'https://bucket.s3.amazonaws.com/';
    expect(describeUploadError(new UploadTransferError(403, '<Error>AccessDenied</Error>', bucket))).toBe(
      'The storage refused the file (status 403).',
    );
  });

  it('says a blocked grant or confirm request was blocked', () => {
    expect(describeUploadError(new ShapioApiError(403, '<html>Blocked</html>'))).toMatch(BLOCKED);
  });
});
