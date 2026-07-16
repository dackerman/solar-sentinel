import { defineConfig, type Plugin } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

// Injects the hashed /assets/* filenames and a content-derived version into
// dist/sw.js so the service worker can precache the bundles at install time.
function swPrecacheManifest(): Plugin {
  return {
    name: 'sw-precache-manifest',
    apply: 'build',
    closeBundle() {
      const distDir = fileURLToPath(new URL('./dist', import.meta.url));
      const assets = readdirSync(join(distDir, 'assets'))
        .sort()
        .map(file => `/assets/${file}`);
      const swPath = join(distDir, 'sw.js');
      const source = readFileSync(swPath, 'utf8');
      const placeholder = '/* __SW_PRECACHE__ */';
      if (!source.includes(placeholder)) {
        throw new Error('sw.js precache placeholder not found; precaching would be disabled');
      }
      const version = createHash('sha256')
        .update(source + assets.join(','))
        .digest('hex')
        .slice(0, 12);
      writeFileSync(
        swPath,
        source.replace(
          placeholder,
          `VERSION = '${version}';\nPRECACHE_ASSETS = ${JSON.stringify(assets)};`
        )
      );
    },
  };
}

export default defineConfig({
  root: 'src',
  publicDir: '../public',
  plugins: [tailwindcss(), swPrecacheManifest()],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
  server: {
    port: 45273,
    allowedHosts: ['homoiconicity'],
    proxy: {
      '/api': 'http://localhost:43187',
    },
  },
  test: {
    globals: true,
    environment: 'happy-dom',
    setupFiles: ['./test/setup.ts'],
  },
});
