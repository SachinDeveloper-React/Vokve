module.exports = {
  preset: '@react-native/jest-preset',
  setupFiles: ['<rootDir>/jest.setup.js'],
  // Only *.test.* files are suites, so __tests__/helpers can hold shared
  // utilities without Jest failing them for containing no tests.
  testMatch: ['**/__tests__/**/*.test.[jt]s?(x)'],
  // The preset only transforms react-native / @react-native packages, but most
  // of this app's dependencies ship untranspiled ESM. Allowing the whole
  // react-native ecosystem through Babel avoids revisiting this list every
  // time a package is added.
  moduleNameMapper: {
    // lucide ships its React Native entry as .mjs, which Jest's transform
    // does not pick up. The CJS build is the same icons.
    '^lucide-react-native$':
      '<rootDir>/node_modules/lucide-react-native/dist/cjs/lucide-react-native.js',
  },
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|@react-navigation|@shopify|react-native-.*|lucide-react-native|immer|zustand)/)',
  ],
};
