const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '..', '..');

const config = getDefaultConfig(projectRoot);

// Enable package.json "exports" field so subpath imports like
// `@dropbeam/crypto-core/rn` resolve to ./src/rn.ts.
config.resolver.unstable_enablePackageExports = true;
config.resolver.unstable_conditionNames = ['react-native', 'require', 'import', 'default'];

config.watchFolders = [monorepoRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
];
config.resolver.disableHierarchicalLookup = false;

// The codebase uses TypeScript-style ".js" suffixes in imports (NodeNext resolution)
// even though the actual files are .ts / .tsx. Metro takes ".js" literally, so we
// rewrite the request to try .tsx then .ts before falling through to .js.
const originalResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName.endsWith('.js') && (moduleName.startsWith('.') || moduleName.startsWith('/'))) {
    for (const ext of ['.tsx', '.ts']) {
      const rewritten = moduleName.replace(/\.js$/, ext);
      try {
        if (originalResolveRequest) {
          return originalResolveRequest(context, rewritten, platform);
        }
        return context.resolveRequest(context, rewritten, platform);
      } catch (_) {
        // fall through to next extension
      }
    }
  }
  if (originalResolveRequest) {
    return originalResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
