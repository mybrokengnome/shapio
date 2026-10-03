/**
 * Parameters the MySQL connection resolves itself just before a statement runs (ADR 0001, "MySQL").
 * They let a `db/` primitive keep its single-expression contract where MySQL needs a statement of its own.
 */

/** The next value of a sequence: allocated from an AUTO_INCREMENT table (no lock held to commit). */
export class SequenceValue {
  readonly name: string;

  constructor(name: string) {
    this.name = name;
  }
}

/**
 * A notification's channel. The statement that binds it inserts the notification; the connection also
 * publishes it to listeners in this process once the transaction commits (or at once outside one).
 */
export class NotificationChannel {
  readonly channel: string;
  readonly payload: string;

  constructor(channel: string, payload: string) {
    this.channel = channel;
    this.payload = payload;
  }
}

/** The table that backs a sequence. */
export const sequenceTableOf = (name: string): string => `sequence_${name}`;
