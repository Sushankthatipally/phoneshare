import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

import { resolveBackendConfig, resolveProbeOrigin } from './config.js';

const { host, port } = resolveBackendConfig();
const origin = resolveProbeOrigin(host, port);
const serverEntry = fileURLToPath(new URL('./index.js', import.meta.url));

let childProcess = null;
let shuttingDown = false;

attachSignalHandlers();

if (await hasHealthyBackend(origin)) {
  console.log(`DropBeam local backend already running at ${origin}. Reusing it for this dev session.`);
  await monitorExistingBackend(origin);
} else {
  await launchBackend();
}

async function monitorExistingBackend(targetOrigin) {
  while (!shuttingDown) {
    await delay(3000);

    if (shuttingDown) {
      return;
    }

    if (await hasHealthyBackend(targetOrigin)) {
      continue;
    }

    console.log(`Existing backend at ${targetOrigin} is no longer reachable. Starting a fresh backend process.`);
    await launchBackend();
    return;
  }
}

async function launchBackend() {
  childProcess = spawn(process.execPath, [serverEntry], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  });

  const exitCode = await new Promise((resolve, reject) => {
    childProcess.once('error', reject);
    childProcess.once('exit', (code, signal) => {
      if (signal) {
        resolve(0);
        return;
      }

      resolve(code ?? 0);
    });
  });

  childProcess = null;

  if (!shuttingDown) {
    process.exit(Number(exitCode));
  }
}

async function hasHealthyBackend(targetOrigin) {
  try {
    const response = await fetch(`${targetOrigin}/api/health`);
    if (!response.ok) {
      return false;
    }

    const payload = await response.json();
    return payload?.ok === true;
  } catch {
    return false;
  }
}

function attachSignalHandlers() {
  const handleShutdown = (signal) => {
    shuttingDown = true;

    if (childProcess && !childProcess.killed) {
      childProcess.kill(signal);
      return;
    }

    process.exit(0);
  };

  process.on('SIGINT', () => handleShutdown('SIGINT'));
  process.on('SIGTERM', () => handleShutdown('SIGTERM'));
}
