import { defineConfig } from 'astro/config';

// Local demo: the browser calls only the public restaurant API, never staff endpoints.
const target = process.env.API_URL ?? 'http://localhost:3010';
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(target).hostname)) {
  throw new Error('The restaurant demo must use a local API.');
}
export default defineConfig({
  devToolbar: { enabled: false },
  vite: {
    server: {
      strictPort: true,
      proxy: {
        '/api': { target, changeOrigin: true, rewrite: (path) => path.replace(/^\/api/, '') },
      },
    },
  },
});
