import type { z } from 'zod';
import type { licensesEditSchema } from '../../../contracts/site.js';

/**
 * The licences page as it ships (RULES P22). Versions and licences were read
 * from the app's installed dependencies on 2026-11-21.
 */
export const DEFAULT_LICENSES: z.input<typeof licensesEditSchema> = {
  seo: {
    title: 'Open-source licences',
    description: 'The open-source software the VOKVE app is built with, and the licences it is used under.',
  },
  hero: {
    eyebrow: 'Credits',
    title: 'Built on the shoulders of open source',
    subtitle: 'VOKVE uses these open-source projects. We are grateful to everyone who maintains them.',
  },
  intro: 'Each project is used under its own licence, linked below.',
  packages: [
    { name: 'React Native', version: '0.87.1', license: 'MIT', url: 'https://github.com/react/react-native' },
    { name: 'React', version: '19.2.3', license: 'MIT', url: 'https://github.com/facebook/react' },
    { name: 'React Navigation', version: '7.3.18', license: 'MIT', url: 'https://github.com/react-navigation/react-navigation' },
    { name: 'React Native Firebase', version: '26.4.0', license: 'Apache-2.0', url: 'https://github.com/invertase/react-native-firebase' },
    { name: 'Notifee', version: '9.1.8', license: 'Apache-2.0', url: 'https://github.com/invertase/notifee' },
    { name: 'React Native Apple Authentication', version: '2.5.1', license: 'Apache-2.0', url: 'https://github.com/invertase/react-native-apple-authentication' },
    { name: 'Nitro Google Sign-In', version: '2.3.0', license: 'MIT', url: 'https://github.com/react-native-nitro-google-sign-in/google-signin' },
    { name: 'Nitro Modules', version: '0.37.1', license: 'MIT', url: 'https://github.com/mrousavy/nitro' },
    { name: 'react-native-step-tracker-pro', version: '2.11.0', license: 'MIT', url: 'https://github.com/SachinDeveloper-React/react-native-step-tracker-pro' },
    { name: 'react-native-step-tracker-pro-ios', version: '1.1.1', license: 'MIT', url: 'https://github.com/SachinDeveloper-React/react-native-step-tracker-pro-ios' },
    { name: 'Reanimated', version: '4.6.0', license: 'MIT', url: 'https://github.com/software-mansion/react-native-reanimated' },
    { name: 'React Native Worklets', version: '0.12.2', license: 'MIT', url: 'https://github.com/software-mansion/react-native-reanimated' },
    { name: 'React Native Screens', version: '4.27.0', license: 'MIT', url: 'https://github.com/software-mansion/react-native-screens' },
    { name: 'React Native SVG', version: '15.15.5', license: 'MIT', url: 'https://github.com/software-mansion/react-native-svg' },
    { name: 'Safe Area Context', version: '5.9.1', license: 'MIT', url: 'https://github.com/AppAndFlow/react-native-safe-area-context' },
    { name: 'Keyboard Controller', version: '1.22.4', license: 'MIT', url: 'https://github.com/kirillzyusko/react-native-keyboard-controller' },
    { name: 'FlashList', version: '2.3.2', license: 'MIT', url: 'https://github.com/Shopify/flash-list' },
    { name: 'MMKV', version: '4.3.2', license: 'MIT', url: 'https://github.com/mrousavy/react-native-mmkv' },
    { name: 'React Native Keychain', version: '10.0.0', license: 'MIT', url: 'https://github.com/oblador/react-native-keychain' },
    { name: 'Device Info', version: '15.0.2', license: 'MIT', url: 'https://github.com/react-native-device-info/react-native-device-info' },
    { name: 'NetInfo', version: '12.0.1', license: 'MIT', url: 'https://github.com/react-native-netinfo/react-native-netinfo' },
    { name: 'Image Picker', version: '8.2.1', license: 'MIT', url: 'https://github.com/react-native-image-picker/react-native-image-picker' },
    { name: 'Clipboard', version: '1.16.3', license: 'MIT', url: 'https://github.com/react-native-clipboard/clipboard' },
    { name: 'Slider', version: '5.2.1', license: 'MIT', url: 'https://github.com/callstack/react-native-slider' },
    { name: 'Linear Gradient', version: '2.8.3', license: 'MIT', url: 'https://github.com/react-native-linear-gradient/react-native-linear-gradient' },
    { name: 'Lucide', version: '1.44.0', license: 'ISC', url: 'https://github.com/lucide-icons/lucide' },
    { name: 'React Hook Form', version: '7.87.0', license: 'MIT', url: 'https://github.com/react-hook-form/react-hook-form' },
    { name: 'Hookform Resolvers', version: '5.9.1', license: 'MIT', url: 'https://github.com/react-hook-form/resolvers' },
    { name: 'Zod', version: '4.6.7', license: 'MIT', url: 'https://github.com/colinhacks/zod' },
    { name: 'Zustand', version: '5.0.15', license: 'MIT', url: 'https://github.com/pmndrs/zustand' },
    { name: 'Immer', version: '11.1.18', license: 'MIT', url: 'https://github.com/immerjs/immer' },
    { name: 'Axios', version: '1.20.0', license: 'MIT', url: 'https://github.com/axios/axios' },
  ],
};
