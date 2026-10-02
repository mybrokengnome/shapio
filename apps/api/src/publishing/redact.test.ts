import { describe, expect, it } from 'vitest';
import { redactHeaders, redactSecrets } from './redact.js';

describe('redaction', () => {
  it('redacts secret-looking keys at any depth', () => {
    expect(
      redactSecrets({ runId: 'r', apiToken: 't', nested: [{ signingSecret: 's', ok: 1 }], password: '' }),
    ).toEqual({
      runId: 'r',
      apiToken: '[redacted]',
      nested: [{ signingSecret: '[redacted]', ok: 1 }],
      password: '',
    });
  });

  it('redacts signature and authorization headers', () => {
    expect(
      redactHeaders({ 'x-shapio-signature': 'v1=abc', authorization: 'Bearer x', 'x-shapio-event': 'e' }),
    ).toEqual({
      'x-shapio-signature': '[redacted]',
      authorization: '[redacted]',
      'x-shapio-event': 'e',
    });
  });
});
