// @vitest-environment jsdom
import '@/test/dom';
import type { OlderClients, OlderClientVersion } from '@shapio/client';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { OlderClientsAck } from '.';

const version = (
  schemaVersion: number,
  effect: 'transparent' | 'converted' | 'nulled',
): OlderClientVersion => ({
  schemaVersion,
  readers: [],
  readerCount: 1,
  otherSites: null,
  definitions: [
    {
      definitionId: 'm1',
      apiKey: 'article',
      status: 'available',
      effect,
      oldestVersion: null,
      fields:
        effect === 'transparent'
          ? []
          : [
              {
                fieldId: 'f1',
                apiKey: 'body',
                effect,
                proposedEffect: effect,
                pastEffect: 'transparent',
                pastSince: null,
              },
            ],
      historyTruncated: false,
    },
  ],
});

const ackOf = (olderClients: OlderClients | null) => {
  render(<OlderClientsAck olderClients={olderClients} />);
  return document.querySelector('[data-older-clients-ack]')?.textContent ?? '';
};

describe('OlderClientsAck', () => {
  it('names the protected and unprotected schema versions', () => {
    expect(
      ackOf({
        versions: [version(42, 'converted'), version(41, 'transparent'), version(40, 'nulled')],
        truncated: false,
      }),
    ).toContain(
      'Protected: readers naming schema version 41 or 42 keep working. Not protected: readers naming schema version 40, and readers that name no schema version.',
    );
  });

  it('says every reader gets the new shape when none names a version', () => {
    expect(ackOf(null)).toContain('No reader names an older schema version');
    expect(screen.getByRole('button', { name: 'More about older schema versions' })).toBeTruthy();
  });
});
