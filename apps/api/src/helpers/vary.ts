import type { FastifyReply } from 'fastify';

/**
 * Adds header names to the reply's `Vary` without dropping the ones already there (`Origin`, set by
 * @fastify/cors when CORS origins are configured). Names compare case-insensitively; `*` wins over all.
 */
export const appendVary = (reply: FastifyReply, names: string): void => {
  const current = reply.getHeader('vary');
  const existing = (Array.isArray(current) ? current.join(',') : String(current ?? ''))
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  if (existing.includes('*')) {
    return;
  }
  const merged = [...existing];
  const seen = new Set(existing.map((name) => name.toLowerCase()));
  for (const name of names.split(',').map((part) => part.trim())) {
    if (name.length > 0 && !seen.has(name.toLowerCase())) {
      seen.add(name.toLowerCase());
      merged.push(name);
    }
  }
  reply.header('vary', merged.join(', '));
};
