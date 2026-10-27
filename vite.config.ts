import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// base './' so the built dist/ works from any static host path.
// During `bun run dev`, /api goes to the Worker started with `bun run dev:api` (port 8787).
export default defineConfig({
  plugins: [svelte()],
  base: './',
  server: {
    proxy: { '/api': { target: 'http://localhost:8787', ws: true } },
  },
});
