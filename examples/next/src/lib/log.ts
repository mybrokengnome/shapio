/** Server-side log lines (`next start` prints them with its own output). */
export const log = (line: string) => {
  process.stderr.write(`[shapio] ${line}\n`);
};
