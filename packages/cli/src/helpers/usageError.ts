/** A command line the command cannot run: printed with the usage, never as a stack. */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}
