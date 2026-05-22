import { join } from 'node:path';

// When running via `node src/index.js` or `pnpm --filter @dropbeam/local-backend run dev`,
// cwd is the package root so process.cwd() resolves correctly.
// When running as a pkg-bundled sidecar, DROPBEAM_DATA_DIR is set by the Tauri host
// so this fallback is never used.
function resolvePackageRoot() {
  return process.env.DROPBEAM_PACKAGE_ROOT ?? process.cwd();
}

export function resolveBackendConfig() {
  const packageRoot = resolvePackageRoot();
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
