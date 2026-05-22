// Bundle the local-backend into a single Windows .exe for Tauri sidecar use.
//
//   pnpm --filter @dropbeam/local-backend run bundle:exe
//
// Steps:
//   1. esbuild bundles src/index.js (ESM, multi-file) into dist/dropbeam-backend.cjs (single CJS).
//   2. @yao-pkg/pkg wraps Node.js + the bundled CJS into a standalone Windows exe.
//   3. The .exe is copied to apps/desktop/src-tauri/binaries/ with the Tauri sidecar naming
//      convention so the Tauri bundler picks it up automatically.

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(packageRoot, '..', '..');
const distDir = join(packageRoot, 'dist');
const bundleFile = join(distDir, 'dropbeam-backend.cjs');
const sidecarOut = join(distDir, 'dropbeam-backend.exe');
const tauriBinariesDir = join(repoRoot, 'apps', 'desktop', 'src-tauri', 'binaries');

const platform = process.platform;
const arch = process.arch;

// Tauri sidecar naming: <name>-<rustTriple>.exe (Windows) / <name>-<rustTriple> (others)
function rustTriple() {
  if (platform === 'win32') return arch === 'arm64' ? 'aarch64-pc-windows-msvc' : 'x86_64-pc-windows-msvc';
  if (platform === 'darwin') return arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin';
  if (platform === 'linux') return arch === 'arm64' ? 'aarch64-unknown-linux-gnu' : 'x86_64-unknown-linux-gnu';
  throw new Error(`unsupported platform ${platform}/${arch}`);
}

const targetTripleSuffix = rustTriple();
const sidecarName = platform === 'win32'
  ? `dropbeam-backend-${targetTripleSuffix}.exe`
  : `dropbeam-backend-${targetTripleSuffix}`;
const sidecarTarget = join(tauriBinariesDir, sidecarName);

const pkgTarget = (() => {
  const nodeMajor = 'node20';
  if (platform === 'win32') return `${nodeMajor}-win-${arch === 'arm64' ? 'arm64' : 'x64'}`;
  if (platform === 'darwin') return `${nodeMajor}-macos-${arch === 'arm64' ? 'arm64' : 'x64'}`;
  if (platform === 'linux') return `${nodeMajor}-linux-${arch === 'arm64' ? 'arm64' : 'x64'}`;
  throw new Error(`unsupported pkg target ${platform}/${arch}`);
})();

function run(cmd, args, opts = {}) {
  console.log(`▶ ${cmd} ${args.join(' ')}`);
  execSync(`${cmd} ${args.join(' ')}`, { stdio: 'inherit', cwd: packageRoot, ...opts });
}

// 1. clean
if (existsSync(distDir)) rmSync(distDir, { recursive: true, force: true });
mkdirSync(distDir, { recursive: true });

// 2. esbuild bundle to a single CJS file
run('npx', [
  'esbuild',
  'src/index.js',
  '--bundle',
  '--platform=node',
  '--target=node20',
  '--format=cjs',
  `--outfile=${bundleFile.replace(/\\/g, '/')}`,
]);

// 3. write a pkg-friendly package.json next to the bundle
writeFileSync(
  join(distDir, 'package.json'),
  JSON.stringify(
    {
      name: 'dropbeam-backend',
      version: '0.1.0',
      bin: 'dropbeam-backend.cjs',
      pkg: { assets: [], targets: [pkgTarget], outputPath: '.' },
    },
    null,
    2,
  ),
);

// 4. invoke @yao-pkg/pkg
run('npx', [
  '@yao-pkg/pkg',
  bundleFile.replace(/\\/g, '/'),
  '--targets',
  pkgTarget,
  '--output',
  sidecarOut.replace(/\\/g, '/'),
  '--compress',
  'GZip',
]);

// 5. place into Tauri binaries dir with the rust-triple name
mkdirSync(tauriBinariesDir, { recursive: true });
copyFileSync(sidecarOut, sidecarTarget);

console.log(`\n✅ Sidecar built: ${sidecarTarget}`);
