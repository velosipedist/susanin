import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	server: {
		host: '0.0.0.0',
		port: 5174,
		allowedHosts: true,
		proxy: { '/api': 'http://localhost:3000' }
	},
	preview: { host: '0.0.0.0', port: 5174, allowedHosts: true },
	plugins: [
		sveltekit({
			compilerOptions: {
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

			// The admin app is a static SPA behind the shared `/admin` path (ADR 0004).
			paths: { base: '/admin' },
			adapter: adapter({ fallback: '200.html' })
		})
	]
});
