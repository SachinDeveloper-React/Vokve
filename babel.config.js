module.exports = api => {
  // Jest reaches lucide through the CJS build (see jest.config.js), which is
  // one file with every icon in it, so there is nothing to save there and a
  // per-icon path would be a second copy of each component — two `Flame`s
  // that are not `===`. The app's bundles, development and release alike,
  // get the rewrite, so what is tested by hand is what ships.
  const isTest = api.env('test');

  return {
    presets: ['module:@react-native/babel-preset'],
    plugins: [
      // Metro does not tree-shake, and lucide's index re-exports all 1,820
      // icons: this turns each named import into the package's own
      // per-icon path, so only the icons the app draws are bundled.
      ...(isTest ? [] : ['./babel-plugins/lucide-direct-imports']),
      // zod v4 uses `export * as ns from '...'`, which the React Native preset
      // does not transform. Without this, bundling fails on zod's own source.
      '@babel/plugin-transform-export-namespace-from',
      // Reanimated 4 runs its animations on the UI thread through Worklets.
      // Without this plugin worklets are never compiled and every animation
      // fails at runtime. It must stay last in the plugin list.
      'react-native-worklets/plugin',
    ],
  };
};
