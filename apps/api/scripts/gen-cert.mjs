// Generates a self-signed cert for local HTTPS so Yahoo's OAuth callback (which
// requires https) works against https://localhost. Browsers will show a one-time
// trust warning for self-signed certs; for a warning-free experience use mkcert
// instead (see README). Certs are written to the repo-root certs/ dir and are gitignored.
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import selfsigned from 'selfsigned';

const here = dirname(fileURLToPath(import.meta.url));
// Write to the repo-root certs/ dir so the Vite dev server (which terminates HTTPS) can use them.
const repoRoot = resolve(here, '..', '..', '..');
const certDir = resolve(repoRoot, 'certs');
const certPath = resolve(certDir, 'localhost.pem');
const keyPath = resolve(certDir, 'localhost-key.pem');

if (existsSync(certPath) && existsSync(keyPath)) {
  console.warn(`Certs already exist at ${certDir} - leaving them in place.`);
  process.exit(0);
}

const attrs = [{ name: 'commonName', value: 'localhost' }];
const pems = await selfsigned.generate(attrs, {
  keySize: 2048,
  algorithm: 'sha256',
  notAfterDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
  extensions: [
    {
      name: 'subjectAltName',
      altNames: [
        { type: 2, value: 'localhost' },
        { type: 7, ip: '127.0.0.1' },
      ],
    },
  ],
});

mkdirSync(certDir, { recursive: true });
writeFileSync(certPath, pems.cert);
writeFileSync(keyPath, pems.private);
console.warn(`Wrote self-signed cert to ${certPath} and key to ${keyPath}`);
