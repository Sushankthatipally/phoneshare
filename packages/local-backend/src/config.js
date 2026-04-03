import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function resolveBackendConfig() {
  return {
    packageRoot,
    dataDir: process.env.DROPBEAM_DATA_DIR ?? join(packageRoot, 'data'),
    host: process.env.DROPBEAM_BACKEND_HOST ?? process.env.HOST ?? '0.0.0.0',
    port: Number(process.env.DROPBEAM_BACKEND_PORT ?? process.env.PORT ?? 17619),
  };
}

export function resolveProbeOrigin(host, port) {
  const probeHost = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host;
  return `http://${probeHost}:${port}`;
}
