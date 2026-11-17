// The Mini App is a static SPA: Telegram supplies identity on the client, and
// the future API is called from the browser. Prerendering the shell is not
// needed while the home is a fixture.
export const ssr = false;
export const prerender = false;
