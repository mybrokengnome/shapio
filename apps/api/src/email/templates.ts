import type { EmailMessage } from './types.js';

const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

const formatExpiry = (expiresAt: Date): string =>
  `${expiresAt.toISOString().slice(0, 16).replace('T', ' ')} UTC`;

type Layout = { to: string; subject: string; paragraphs: string[]; action?: { label: string; url: string } };

/** Plain text plus a minimal inline-styled HTML body (email clients ignore stylesheets). */
const render = ({ to, subject, paragraphs, action }: Layout): EmailMessage => ({
  to,
  subject,
  text: [...paragraphs, ...(action ? [`${action.label}: ${action.url}`] : [])].join('\n\n'),
  html: [
    '<!doctype html><html><body style="font-family:sans-serif;line-height:1.5;color:#0f172a">',
    ...paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`),
    ...(action
      ? [`<p><a href="${escapeHtml(action.url)}" style="color:#2563eb">${escapeHtml(action.label)}</a></p>`]
      : []),
    '</body></html>',
  ].join(''),
});

type InvitationEmail = {
  to: string;
  inviterName: string | undefined;
  instanceUrl: string;
  acceptUrl: string;
  expiresAt: Date;
};

export const invitationEmail = ({ to, inviterName, instanceUrl, acceptUrl, expiresAt }: InvitationEmail) =>
  render({
    to,
    subject: 'You have been invited to Shapio',
    paragraphs: [
      `${inviterName ?? 'An administrator'} invited you to the Shapio admin at ${instanceUrl}.`,
      `The invitation expires at ${formatExpiry(expiresAt)}. If you did not expect it, ignore this email.`,
    ],
    action: { label: 'Accept the invitation', url: acceptUrl },
  });

type PasswordResetEmail = { to: string; instanceUrl: string; resetUrl: string; expiresAt: Date };

export const passwordResetEmail = ({ to, instanceUrl, resetUrl, expiresAt }: PasswordResetEmail) =>
  render({
    to,
    subject: 'Reset your Shapio password',
    paragraphs: [
      `Someone asked to reset the password of your Shapio account at ${instanceUrl}.`,
      `The link expires at ${formatExpiry(expiresAt)} and works once. If it was not you, ignore this email; your password stays the same.`,
    ],
    action: { label: 'Choose a new password', url: resetUrl },
  });

/** The host of the site an app user signed up on (the page the link opens), for wording the email. */
const siteOf = (linkUrl: string): string => new URL(linkUrl).host;

type AppUserLinkEmail = { to: string; linkUrl: string; expiresAt: Date };

/** Sent to app users (end users of the site), so it names their site, never Shapio. */
export const appEmailConfirmationEmail = ({ to, linkUrl, expiresAt }: AppUserLinkEmail) =>
  render({
    to,
    subject: `Confirm your email address for ${siteOf(linkUrl)}`,
    paragraphs: [
      `Confirm that ${to} is your email address to finish setting up your account on ${siteOf(linkUrl)}.`,
      `The link expires at ${formatExpiry(expiresAt)}. If you did not sign up, ignore this email.`,
    ],
    action: { label: 'Confirm my email address', url: linkUrl },
  });

export const appPasswordResetEmail = ({ to, linkUrl, expiresAt }: AppUserLinkEmail) =>
  render({
    to,
    subject: `Reset your password for ${siteOf(linkUrl)}`,
    paragraphs: [
      `Someone asked to reset the password of your account on ${siteOf(linkUrl)}.`,
      `The link expires at ${formatExpiry(expiresAt)} and works once. If it was not you, ignore this email; your password stays the same.`,
    ],
    action: { label: 'Choose a new password', url: linkUrl },
  });

type AppRegistrationAttemptEmail = { to: string; siteUrl: string };

/**
 * Sent instead of a confirmation link when someone signs up with an address that already has an account, so
 * the sign-up answer itself never reveals that the account exists.
 */
export const appRegistrationAttemptEmail = ({ to, siteUrl }: AppRegistrationAttemptEmail) =>
  render({
    to,
    subject: `Sign-up attempt for ${siteOf(siteUrl)}`,
    paragraphs: [
      `Someone tried to create an account on ${siteOf(siteUrl)} with ${to}, but this address already has an account. Nothing was changed.`,
      'If it was you, sign in with your existing account, or reset your password if you forgot it. If it was not you, ignore this email.',
    ],
  });
