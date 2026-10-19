import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';

// In development the browser calls /api on this dev server, which forwards to the API, so no CORS setup is needed.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react()],
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
    server: {
      port: Number(env.WEB_PORT ?? 5173),
      proxy: { '/api': { target: env.API_PROXY_TARGET ?? 'http://127.0.0.1:5000', changeOrigin: true } },
    },
  };
});
