import type { FastifyBaseLogger } from 'fastify';
import type { EmailTransport } from './types.js';

/**
 * Development transport: writes the message to the log instead of sending it. Links in it carry live
 * tokens, so production installs should configure SMTP (EMAIL_TRANSPORT=smtp).
 */
export const createConsoleTransport = (log: FastifyBaseLogger): EmailTransport => ({
  send: async (message) => {
    log.info(
      { to: message.to, subject: message.subject },
      `email (console transport, not sent):\n${message.text}`,
    );
  },
});
