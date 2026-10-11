import { describe, expect, it } from 'vitest';
import { isSupportedNode, unsupportedNodeMessage } from './nodeVersion.js';

describe('isSupportedNode', () => {
  it.each([
    ['24.0.0', true],
    ['24.11.1', true],
    ['25.2.0', true],
    ['23.11.0', false],
    ['22.12.0', false],
    ['18.20.4', false],
  ])('%s -> %s', (version, expected) => {
    expect(isSupportedNode(version)).toBe(expected);
  });
});

describe('unsupportedNodeMessage', () => {
  it('names the command and the running version on old Node', () => {
    expect(unsupportedNodeMessage('22.12.0', 'shapio')).toBe(
      'shapio needs Node.js 24 or newer, and this is v22.12.0. Install a newer Node.js from https://nodejs.org/ ' +
        'or with your version manager, then run the command again.',
    );
  });

  it('is undefined on a supported version', () => {
    expect(unsupportedNodeMessage('24.0.0', 'shapio')).toBeUndefined();
  });
});
