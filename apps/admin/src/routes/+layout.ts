// The admin app is a static SPA: the public shell renders anywhere, and every
// piece of data comes from the session-protected `/api/admin` routes.
export const ssr = false;
export const prerender = false;
