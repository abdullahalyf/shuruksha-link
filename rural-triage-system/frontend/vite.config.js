import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite dev-server proxy: in development, leave VITE_API_BASE_URL empty
// and the SPA hits the same-origin /api and /healthz paths. Vite forwards
// them to the local Express backend on :5000, avoiding CORS noise and
// letting the production build talk to an absolute URL with no code change.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
      '/healthz': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
    },
  },
});
