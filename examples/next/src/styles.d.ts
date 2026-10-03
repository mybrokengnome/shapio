// Global stylesheets are imported for their side effect (Next's own declarations arrive in next-env.d.ts,
// which `next build` writes; this keeps `npm run typecheck` working before the first build).
declare module '*.css';
