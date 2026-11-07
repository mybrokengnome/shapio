/** Where a command writes output and reads its environment; injectable for tests. */
export type CliIo = {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  env: Readonly<Record<string, string | undefined>>;
};

/** Returns the process exit code. */
export type CliCommand = {
  summary: string;
  usage: string;
  /** A kept older name (an alias): it still runs, but help and the CLI reference leave it out. */
  hidden?: boolean;
  run: (args: readonly string[], io: CliIo) => Promise<number>;
};
