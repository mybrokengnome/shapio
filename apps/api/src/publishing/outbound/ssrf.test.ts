import { BlockList } from 'node:net';
import { describe, expect, it } from 'vitest';
import { toAllowlist } from '../../config/publishing.js';
import {
  isRestrictedAddress,
  OutboundBlockedError,
  parseDestination,
  resolveDestination,
  trustedOutboundPolicy,
  type OutboundPolicy,
} from './ssrf.js';

const policy = (overrides: Partial<OutboundPolicy> = {}): OutboundPolicy => ({
  allowPrivateNetwork: false,
  allowlist: new BlockList(),
  resolve: () => Promise.resolve([{ address: '93.184.216.34', family: 4 }]),
  ...overrides,
});

describe('SSRF address checks', () => {
  it.each([
    '127.0.0.1',
    '127.255.0.9',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '255.255.255.255',
    '::1',
    '::',
    'fe80::1',
    'fc00::1',
    'fd12:3456::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '::ffff:a9fe:a9fe',
    '64:ff9b::10.0.0.1',
    // Transition forms that can carry any IPv4 address, private ones included.
    '2002:c0a8:0101::1', // 6to4 of 192.168.1.1
    '2001:0:4136:e378:8000:63bf:3fff:fdd2', // Teredo
    '64:ff9b:1::a00:1', // NAT64 local-use
    '::7f00:1', // IPv4-compatible ::127.0.0.1
    '::127.0.0.1',
  ])('treats %s as restricted', (address) => {
    expect(isRestrictedAddress(address)).toBe(true);
  });

  it.each(['93.184.216.34', '1.1.1.1', '172.32.0.1', '2606:4700:4700::1111', '64:ff9b::1.1.1.1'])(
    'treats %s as public',
    (address) => {
      expect(isRestrictedAddress(address)).toBe(false);
    },
  );

  it('refuses IP literals and names that resolve to private addresses', async () => {
    await expect(resolveDestination(parseDestination('http://127.0.0.1:8080/x'), policy())).rejects.toThrow(
      OutboundBlockedError,
    );
    await expect(resolveDestination(parseDestination('http://[::1]/x'), policy())).rejects.toThrow(
      OutboundBlockedError,
    );
    const rebinding = policy({ resolve: () => Promise.resolve([{ address: '10.0.0.5', family: 4 }]) });
    await expect(resolveDestination(parseDestination('https://evil.example/x'), rebinding)).rejects.toThrow(
      /10\.0\.0\.5/,
    );
  });

  it('refuses a name when any resolved address is private', async () => {
    const mixed = policy({
      resolve: () =>
        Promise.resolve([
          { address: '93.184.216.34', family: 4 },
          { address: '169.254.169.254', family: 4 },
        ]),
    });
    await expect(resolveDestination(parseDestination('https://mixed.example/'), mixed)).rejects.toThrow(
      OutboundBlockedError,
    );
  });

  it('needs both the opt-in and the operator allowlist for private destinations', async () => {
    const url = parseDestination('http://127.0.0.1:9000/hook');
    const allowlist = toAllowlist(['127.0.0.1/32']);
    await expect(resolveDestination(url, policy({ allowlist }))).rejects.toThrow(OutboundBlockedError);
    await expect(resolveDestination(url, policy({ allowPrivateNetwork: true }))).rejects.toThrow(
      OutboundBlockedError,
    );
    await expect(resolveDestination(url, policy({ allowPrivateNetwork: true, allowlist }))).resolves.toEqual({
      address: '127.0.0.1',
      family: 4,
    });
    await expect(
      resolveDestination(
        parseDestination('http://10.0.0.1/'),
        policy({ allowPrivateNetwork: true, allowlist }),
      ),
    ).rejects.toThrow(OutboundBlockedError);
  });

  it('accepts only http(s) URLs without credentials', () => {
    expect(() => parseDestination('ftp://example.com/')).toThrow(OutboundBlockedError);
    expect(() => parseDestination('file:///etc/passwd')).toThrow(OutboundBlockedError);
    expect(() => parseDestination('https://user:pass@example.com/')).toThrow(/credentials/);
    expect(() => parseDestination('not a url')).toThrow(OutboundBlockedError);
  });

  it('allows loopback and private destinations under the operator-trusted policy', async () => {
    const trusted = trustedOutboundPolicy(() => Promise.resolve([{ address: '10.0.0.5', family: 4 }]));
    await expect(resolveDestination(parseDestination('http://127.0.0.1:11434/v1'), trusted)).resolves.toEqual(
      { address: '127.0.0.1', family: 4 },
    );
    await expect(resolveDestination(parseDestination('http://[::1]/v1'), trusted)).resolves.toEqual({
      address: '::1',
      family: 6,
    });
    await expect(resolveDestination(parseDestination('https://llm.internal/v1'), trusted)).resolves.toEqual({
      address: '10.0.0.5',
      family: 4,
    });
  });
});
