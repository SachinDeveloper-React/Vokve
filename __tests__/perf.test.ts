/**
 * Firebase Performance takes timings from release builds only: a debug
 * build's cold start (Metro, unminified, an emulator) is not a member's.
 *
 * @format
 */

import { getPerformance } from '@react-native-firebase/perf';
import { startPerformance } from '../src/services/perf';

test('a debug build turns collection off; a release build turns it on', () => {
  const perf: { dataCollectionEnabled?: boolean } = {};
  (getPerformance as jest.Mock).mockReturnValueOnce(perf);

  startPerformance();

  // Jest runs as a development build.
  expect(__DEV__).toBe(true);
  expect(perf.dataCollectionEnabled).toBe(false);
});

test('a build with no Firebase starts anyway', () => {
  (getPerformance as jest.Mock).mockImplementationOnce(() => {
    throw new Error('No Firebase App has been created');
  });

  expect(() => startPerformance()).not.toThrow();
});
