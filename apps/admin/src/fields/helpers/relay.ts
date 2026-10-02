/**
 * A stable function that calls whatever handler was set last. Editor extensions are built once per editor
 * (Tiptap can't swap them), while the React handlers they call change every render: the component sets the
 * current handler in an effect, and the extension calls the relay.
 */
export const createRelay = <Args extends unknown[], Result>(fallback: (...args: Args) => Result) => {
  let handler = fallback;
  return {
    set: (next: (...args: Args) => Result) => {
      handler = next;
    },
    reset: () => {
      handler = fallback;
    },
    call: (...args: Args): Result => handler(...args),
  };
};

export type Relay<Args extends unknown[], Result> = ReturnType<typeof createRelay<Args, Result>>;
