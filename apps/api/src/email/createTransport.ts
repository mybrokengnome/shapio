import type { FastifyBaseLogger } from 'fastify';
import type { EmailConfig } from '../config/index.js';
import { createConsoleTransport } from './consoleTransport.js';
import { createSmtpTransport } from './smtpTransport.js';
import type { EmailTransport } from './types.js';

export const createEmailTransport = (config: EmailConfig, log: FastifyBaseLogger): EmailTransport =>
  config.transport === 'smtp' ? createSmtpTransport(config) : createConsoleTransport(log);
