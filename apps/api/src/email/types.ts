export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

/** Sends one message or throws (the email job retries with backoff). */
export type EmailTransport = {
  send: (message: EmailMessage) => Promise<void>;
};
