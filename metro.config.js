const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

/** zod's own files, from which its locale index is asked for. */
const INSIDE_ZOD = /[\\/]node_modules[\\/]zod[\\/]v4[\\/]/;
const ZOD_LOCALES_SHIM = path.join(__dirname, 'shims', 'zod-locales.js');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * The RN 0.87 defaults already enable `inlineRequires`, which is the setting
 * that matters most for cold-start time, so there is nothing to override
 * there.
 *
 * The one override is for size. zod's entry points re-export every locale
 * (`export * as locales from "../locales/index.js"`) and Metro bundles what
 * is imported whether or not it is used, so the request is answered with a
 * file that carries English alone — see `shims/zod-locales.js`.
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = {
  resolver: {
    resolveRequest(context, moduleName, platform) {
      if (
        moduleName === '../locales/index.js' &&
        INSIDE_ZOD.test(context.originModulePath)
      ) {
        return { type: 'sourceFile', filePath: ZOD_LOCALES_SHIM };
      }
      return context.resolveRequest(context, moduleName, platform);
    },
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
