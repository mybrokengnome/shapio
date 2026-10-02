import nodemailer from 'nodemailer';
import type { EmailConfig } from '../config/index.js';
import type { EmailTransport } from './types.js';

type SmtpConfig = Extract<EmailConfig, { transport: 'smtp' }>;

/** SMTP via nodemailer. STARTTLS is used whenever the server offers it; `secure` means implicit TLS. */
export const createSmtpTransport = (config: SmtpConfig): EmailTransport => {
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    ...(config.user ? { auth: { user: config.user, pass: config.password ?? '' } } : {}),
  });
  return {
    send: async (message) => {
      await transporter.sendMail({ from: config.from, ...message });
    },
  };
};
