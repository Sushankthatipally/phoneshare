#!/usr/bin/env node
// Wrapper invoked in place of @expo/cli by RN's BundleHermesCTask.
// On Windows, RN's gradle plugin converts the --entry-file path to relative-from-root,
// which @expo/cli then misresolves. We convert it back to absolute before delegating.
const path = require('path');
const args = process.argv.slice(2);

const cwd = process.cwd();
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--entry-file' || a === '--bundle-output' || a === '--assets-dest' || a === '--sourcemap-output') {
    const v = args[i + 1];
    if (v && !path.isAbsolute(v)) {
      args[i + 1] = path.resolve(cwd, v);
    }
  }
}

// Delegate to real @expo/cli
const expoCliPath = require.resolve('@expo/cli', {
  paths: [require.resolve('expo/package.json', { paths: [cwd] })],
});
process.argv = [process.argv[0], expoCliPath, ...args];
require(expoCliPath);
