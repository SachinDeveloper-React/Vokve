/**
 * Reanimated's own `mock` entry still pulls in `mutables.native`, which reaches
 * react-native-worklets and throws under Jest. This stand-in implements only
 * the surface the app uses, with no native dependency at all.
 *
 * It deliberately does not simulate animation: shared values update
 * synchronously and `withTiming` resolves to its target immediately, so tests
 * assert final state rather than frames.
 */
const React = require('react');
const { View, Text, Image, ScrollView } = require('react-native');

const passthrough = value => value;

const createAnimatedComponent = Component => Component;

/** The output stop for whichever input stop `value` sits closest to. */
const nearestStop = (value, input, output) => {
  let closest = 0;
  input.forEach((stop, index) => {
    if (Math.abs(stop - value) < Math.abs(input[closest] - value)) {
      closest = index;
    }
  });
  return output[closest];
};

const Animated = {
  View,
  Text,
  Image,
  ScrollView,
  createAnimatedComponent,
};

module.exports = {
  __esModule: true,
  default: Animated,

  createAnimatedComponent,

  useSharedValue: initial => ({ value: initial }),
  useAnimatedStyle: factory => factory(),
  useAnimatedProps: factory => factory(),
  useDerivedValue: factory => ({ value: factory() }),
  useAnimatedRef: () => React.createRef(),

  /**
   * Interpolation without the animation: the value is clamped to the input
   * range and the matching output stop is returned. Frames are not simulated
   * anywhere else in this mock, so a midpoint blend would be a fidelity these
   * tests neither have nor need.
   */
  interpolate: (value, input, output) => nearestStop(value, input, output),
  interpolateColor: (value, input, output) => nearestStop(value, input, output),

  withTiming: passthrough,
  withSpring: passthrough,
  withDelay: (_delay, value) => value,
  withSequence: (...values) => values[values.length - 1],
  withRepeat: passthrough,
  cancelAnimation: () => {},
  runOnJS: fn => fn,
  runOnUI: fn => fn,

  Easing: {
    linear: passthrough,
    ease: passthrough,
    quad: passthrough,
    cubic: passthrough,
    in: passthrough,
    out: passthrough,
    inOut: passthrough,
    bezier: () => passthrough,
  },

  FadeIn: {},
  FadeOut: {},
  Layout: {},
};
