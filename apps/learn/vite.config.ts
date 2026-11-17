import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	// The dev server is reached through an HTTPS tunnel for phone testing.
	server: { host: '0.0.0.0', allowedHosts: true },
	preview: { host: '0.0.0.0', allowedHosts: true },
	plugins: [
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

			// The learner app is a static SPA behind the shared `/learn` path (ADR 0001, 0004).
			paths: { base: '/learn' },
			adapter: adapter({ fallback: '200.html' })
		})
	]
});
