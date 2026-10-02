import { describe, expect, it } from 'vitest';
import { EMPTY_WEBHOOK, toWebhookInput, webhookSchema } from './helpers';

const valid = { ...EMPTY_WEBHOOK, name: 'Site', url: 'https://example.com/hook', events: ['entry.*'] };

describe('webhookSchema', () => {
  it('accepts a complete webhook and converts it for the API', () => {
    const parsed = webhookSchema.parse(valid);
    expect(toWebhookInput(parsed)).toEqual({
      name: 'Site',
      url: 'https://example.com/hook',
      events: ['entry.*'],
      enabled: true,
      allowPrivateNetwork: false,
      maxAttempts: 8,
    });
  });

  it.each([
    ['a non-http URL', { url: 'ftp://example.com' }, 'validation.url'],
    ['no events', { events: [] }, 'validation.selectEvents'],
    ['zero attempts', { maxAttempts: '0' }, 'validation.maxAttempts'],
    ['too many attempts', { maxAttempts: '21' }, 'validation.maxAttempts'],
    ['a fractional number', { maxAttempts: '2.5' }, 'validation.maxAttempts'],
  ])('rejects %s', (_name, change, message) => {
    const result = webhookSchema.safeParse({ ...valid, ...change });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(message);
  });
});
