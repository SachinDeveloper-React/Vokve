module.exports = {
  root: true,
  extends: '@react-native',
  overrides: [
    {
      // Node tooling, not app code: these run under `node` directly, so
      // they are real ES modules with `import.meta` — which the React
      // Native preset's parser settings do not expect.
      files: ['scripts/**/*.mjs'],
      parserOptions: {sourceType: 'module', ecmaVersion: 2022},
      env: {node: true, 'react-native/react-native': false},
    },
  ],
};
