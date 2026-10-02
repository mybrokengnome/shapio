import type { EmailMessage, EmailTransport } from '../../src/email/types.js';

export type MemoryEmailTransport = EmailTransport & { sent: EmailMessage[] };

/** Collects messages instead of sending them. */
export const createMemoryEmailTransport = (): MemoryEmailTransport => {
  const sent: EmailMessage[] = [];
  return {
    sent,
    send: async (message) => {
      sent.push(message);
    },
  };
};

/** The token in a `…#token=<value>` link of the most recent message to `to`. */
export const lastTokenSentTo = (transport: MemoryEmailTransport, to: string): string => {
  const message = transport.sent.filter((m) => m.to === to).at(-1);
  const token = message ? /#token=([A-Za-z0-9_-]+)/.exec(message.text)?.[1] : undefined;
  if (!token) {
    throw new Error(`No token email was sent to ${to}`);
  }
  return token;
};
