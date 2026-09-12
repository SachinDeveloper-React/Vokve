/**
 * Single entry point for the component library.
 *
 * `Alert` here is this app's inline banner, not React Native's imperative
 * dialog API. Import the platform one explicitly where both are needed:
 * `import { Alert as NativeAlert } from 'react-native'`.
 */
export * from './layout';
export * from './ui';
export * from './form';
export * from './media';
export * from './feedback';
export * from './disclosure';
export * from './wallet';
export * from './shop';
export * from './account';
export * from './streak';
export * from './notifications';
export * from './challenges';
export * from './leaderboard';
export * from './hydration';
export { default as ErrorBoundary } from './common/ErrorBoundary';
export { Wordmark } from './brand/Wordmark';
export type { WordmarkSize } from './brand/Wordmark';
export { AuthHeroBackdrop } from './auth/AuthHeroBackdrop';
export { SocialAuthRow } from './auth/SocialAuthRow';
export type { SocialProvider } from './auth/SocialAuthRow';
export { VerificationHeroArt } from './auth/VerificationHeroArt';
export { OtpSafetyNote } from './auth/OtpSafetyNote';
export { ResendOtpRow } from './auth/ResendOtpRow';
export { ProfileHeroBadge } from './onboarding/ProfileHeroBadge';
export { HomeHeader } from './home/HomeHeader';
export { MotivationCard } from './home/MotivationCard';
export { MotivationArt, MOTIVATION_EMOJIS } from './home/MotivationArt';
export { QuickActionCard } from './home/QuickActionCard';
export { QuickActionsRow } from './home/QuickActionsRow';
export { HydrationCard } from './fitness/HydrationCard';
export { HydrationGlasses } from './fitness/HydrationGlasses';
export { HydrationPip } from './fitness/HydrationPip';
export { HydrationQuickAdd } from './fitness/HydrationQuickAdd';
export { WaterDroplet } from './fitness/WaterDroplet';
export { ActivityMetricsRow } from './fitness/ActivityMetricsRow';
export { MetricTile } from './fitness/MetricTile';
export { ProgressRing } from './fitness/ProgressRing';
export { StepGoalCard } from './fitness/StepGoalCard';
export { WeeklyTrainingCard } from './fitness/WeeklyTrainingCard';
export { WeeklyStepsChart } from './fitness/WeeklyStepsChart';
export { StepBarColumn } from './fitness/StepBarColumn';
export type { DaySteps } from './fitness/WeeklyStepsChart';
export { StatTile } from './fitness/StatTile';
export { WorkoutCard } from './fitness/WorkoutCard';
