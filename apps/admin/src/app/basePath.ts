/**
 * The router's basename is the path of `<base href>`: `{BASE_PATH}/admin` in production (injected by the
 * API), `/admin` in development (injected by Vite). Trailing slash removed, as the router expects.
 */
export const routerBasePath = () => new URL(document.baseURI).pathname.replace(/\/+$/, '') || '/';
