import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import { BundleFormatError, parseRecord, toLine, type BundleRecord, type HeaderRecord } from './format.js';

/** Thrown when the reader of an export stream went away (client disconnected); the export stops. */
export class StreamClosedError extends Error {
  constructor() {
    super('The export stream was closed by the reader');
    this.name = 'StreamClosedError';
  }
}

/** Writes one record, waiting for the reader when the stream's buffer is full. */
export const writeRecord = async (output: Writable, record: BundleRecord): Promise<void> => {
  if (output.destroyed) {
    throw new StreamClosedError();
  }
  if (output.write(toLine(record))) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      output.off('drain', onDrain);
      output.off('close', onClose);
    };
    const onDrain = () => {
      cleanup();
      resolve();
    };
    const onClose = () => {
      cleanup();
      reject(new StreamClosedError());
    };
    output.on('drain', onDrain);
    output.on('close', onClose);
  });
};

export type NumberedRecord = { line: number; record: BundleRecord };

/**
 * Reads a bundle record by record, validating each line and the framing: a header first, an `end` record
 * last (a truncated download has none), nothing after it.
 */
export async function* readBundle(input: Readable): AsyncGenerator<NumberedRecord> {
  const lines = createInterface({ input, crlfDelay: Infinity });
  let line = 0;
  let header: HeaderRecord | undefined;
  let ended = false;
  for await (const text of lines) {
    line += 1;
    if (text.trim() === '') {
      continue;
    }
    if (ended) {
      throw new BundleFormatError(line, 'content after the end record');
    }
    const record = parseRecord(text, line);
    if (!header) {
      if (record.type !== 'header') {
        throw new BundleFormatError(line, 'the first record must be the header');
      }
      header = record;
    } else if (record.type === 'header') {
      throw new BundleFormatError(line, 'a second header');
    }
    ended = record.type === 'end';
    yield { line, record };
  }
  if (!header) {
    throw new BundleFormatError(line, 'the bundle is empty');
  }
  if (!ended) {
    throw new BundleFormatError(line, 'the bundle is truncated (no end record)');
  }
}
