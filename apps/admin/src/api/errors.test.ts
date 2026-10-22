import { ShapioApiError } from '@shapio/client';
import { describe, expect, it } from 'vitest';
import { isBlockedRequest, isForbidden, isShapioErrorText } from './errors';

const shapio403 = () =>
  new ShapioApiError(403, { error: { code: 'FORBIDDEN', message: 'Your role does not allow this.' } });
/** What the client makes of a WAF's HTML page (the body parses to text, not Shapio's shape). */
const firewall403 = () => new ShapioApiError(403, '<html><body><h1>403 Forbidden</h1></body></html>');

describe('403 classification', () => {
  it("is a permission denial when the body is Shapio's error shape", () => {
    expect(isForbidden(shapio403())).toBe(true);
    expect(isBlockedRequest(shapio403())).toBe(false);
  });

  it('is a blocked request when the body is HTML, text or empty', () => {
    for (const error of [
      firewall403(),
      new ShapioApiError(403, 'Forbidden'),
      new ShapioApiError(403, null),
    ]) {
      expect(isBlockedRequest(error)).toBe(true);
      expect(isForbidden(error)).toBe(false);
    }
  });

  it('is neither for other statuses or other errors', () => {
    expect(isBlockedRequest(new ShapioApiError(401, '<html></html>'))).toBe(false);
    expect(isBlockedRequest(new Error('Request failed with status 403'))).toBe(false);
  });
});

describe('isShapioErrorText', () => {
  it("recognizes Shapio's JSON error body and nothing else", () => {
    expect(isShapioErrorText('{"error":{"code":"FORBIDDEN","message":"No."}}')).toBe(true);
    expect(isShapioErrorText('<html>403 Forbidden</html>')).toBe(false);
    expect(isShapioErrorText('{"message":"Forbidden"}')).toBe(false);
    expect(isShapioErrorText('')).toBe(false);
  });
});
