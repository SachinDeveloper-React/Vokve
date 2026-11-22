import type { HealthConnectStatus } from 'react-native-step-tracker-pro';

/**
 * The phone's health store, by the name the user knows it: Health Connect
 * on Android, Apple Health on an iPhone. The tracker drives both through
 * the same "Health Connect" calls; its status says which one answered
 * (`provider: 'healthkit'` from react-native-step-tracker-pro-ios).
 */
export type HealthStoreName = 'Health Connect' | 'Apple Health';

export const healthStoreName = (
  status: HealthConnectStatus | null | undefined,
): HealthStoreName =>
  status?.provider === 'healthkit' ? 'Apple Health' : 'Health Connect';

/** Whether the store is Apple Health, which Vokve only ever reads. */
export const isAppleHealth = (
  status: HealthConnectStatus | null | undefined,
): boolean => status?.provider === 'healthkit';
