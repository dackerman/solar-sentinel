import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// Isolated visual prototype: no forecast API, app bundle, or service worker.
export default defineConfig({
  root: 'src',
  publicDir: false,
  server: {
    host: '0.0.0.0',
    port: 45379,
    strictPort: true,
    allowedHosts: ['homoiconicity', 'homoiconicity.tail663e6.ts.net'],
  },
  build: {
    outDir: '../dist-scene',
    emptyOutDir: true,
    rollupOptions: {
      input: fileURLToPath(new URL('./src/scene-demo.html', import.meta.url)),
    },
  },
});
