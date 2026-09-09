import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8787',
      '/stream': 'http://localhost:8787',
    },
  },
  build: {
    target: 'es2019',
    // Keep previous hashed assets so a page loaded during a rebuild still finds its files.
    emptyOutDir: false,
  },
});
