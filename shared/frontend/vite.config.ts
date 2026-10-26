import basicSsl from '@vitejs/plugin-basic-ssl';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';

// In development the browser calls /api on this dev server, which forwards to the API, so no CORS setup is needed.
// `npm run dev:phone` (mode "phone"): HTTPS with a local certificate and open to the network, so a phone on the same
// Wi-Fi or hotspot can use its camera (browsers allow the camera only over HTTPS) for the live walk-around.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const phone = mode === 'phone';
  return {
    plugins: [react(), ...(phone ? [basicSsl()] : [])],
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
    server: {
      host: phone ? true : undefined,
      port: Number(env.WEB_PORT ?? 5173),
      proxy: { '/api': { target: env.API_PROXY_TARGET ?? 'http://127.0.0.1:5000', changeOrigin: true } },
    },
  };
});
