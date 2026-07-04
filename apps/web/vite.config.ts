/// <reference types="node" />
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const webDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(webDir, '..', '..');

// Terminate HTTPS on the dev server (Yahoo requires an https redirect URI). Falls
// back to http if certs are missing - run `npm run gen:cert` first (see README).
function devHttps() {
  try {
    return {
      key: readFileSync(resolve(repoRoot, 'certs', 'localhost-key.pem')),
      cert: readFileSync(resolve(repoRoot, 'certs', 'localhost.pem')),
    };
  } catch {
    return undefined;
  }
}

const API_TARGET = 'http://localhost:8787';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    https: devHttps(),
    // Proxy auth + api to the API server so everything is first-party to the web
    // origin (session cookie survives the Yahoo OAuth redirect).
    proxy: {
      '/auth': { target: API_TARGET, changeOrigin: true, secure: false },
      '/api': { target: API_TARGET, changeOrigin: true, secure: false },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/setupTests.ts'],
  },
});
