/**
 * In-process reads open database connections, which the Edge runtime (Next.js middleware and `runtime = 'edge'`
 * routes, Vercel Edge Functions) cannot. Spelled out so bundlers that inline `process.env.NEXT_RUNTIME` see it.
 */
export const assertNodeRuntime = (): void => {
  const edge =
    (typeof process !== 'undefined' && process.env.NEXT_RUNTIME === 'edge') ||
    typeof (globalThis as { EdgeRuntime?: unknown }).EdgeRuntime !== 'undefined';
  if (edge) {
    throw new Error(
      '@shapio/local reads the database and runs on the Node.js runtime only. Use it from a Node.js route ' +
        "or page, or read over HTTP with @shapio/client's createClient on the Edge runtime",
    );
  }
};
