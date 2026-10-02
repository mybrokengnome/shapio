import { existsSync, readFileSync } from 'node:fs';
import { SERVER_LOG } from './constants';

const POLL_MS = 200;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const readLog = () => (existsSync(SERVER_LOG) ? readFileSync(SERVER_LOG, 'utf8') : '');

/** Waits until the server log matches `pattern` (after `fromOffset`), returning the match. */
export const waitForLog = async (
  pattern: RegExp,
  timeoutMs = 15_000,
  fromOffset = 0,
): Promise<RegExpMatchArray> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const match = readLog().slice(fromOffset).match(pattern);
    if (match) {
      return match;
    }
    await sleep(POLL_MS);
  }
  throw new Error(`Timed out waiting for ${String(pattern)} in the server log (${SERVER_LOG})`);
};

/** Current log length: pass it to `waitForLog` to only match lines written afterwards. */
export const logOffset = () => readLog().length;

/** The latest emailed link of a kind (console email transport), e.g. `http://…/cms/admin/reset-password#token=…`. */
export const waitForEmailedLink = async (kind: 'accept-invitation' | 'reset-password', fromOffset: number) =>
  (
    await waitForLog(
      new RegExp(`https?://[^\\s"\\\\]+(/admin/${kind}#token=[A-Za-z0-9_%-]+)`),
      15_000,
      fromOffset,
    )
  )[0] ?? '';
