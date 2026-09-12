module.exports = {
  presets: ['module:@react-native/babel-preset'],
  plugins: [
    // zod v4 uses `export * as ns from '...'`, which the React Native preset
    // does not transform. Without this, bundling fails on zod's own source.
    '@babel/plugin-transform-export-namespace-from',
    // Reanimated 4 runs its animations on the UI thread through Worklets.
    // Without this plugin worklets are never compiled and every animation
    // fails at runtime. It must stay last in the plugin list.
    'react-native-worklets/plugin',
  ],
};
