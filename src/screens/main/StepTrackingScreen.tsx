import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform, ScrollView, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { ActionSheet } from '../../components/disclosure/ActionSheet';
import { useToast } from '../../components/feedback/Toast';
import { BackgroundCountingCard } from '../../components/steps/BackgroundCountingCard';
import {
  HealthConnectCard,
  healthConnectCardState,
} from '../../components/steps/HealthConnectCard';
import {
  StepCountingCard,
  type CountingState,
} from '../../components/steps/StepCountingCard';
import { StepSourcesLinkCard } from '../../components/steps/StepSourcesLinkCard';
import { StepSyncCard } from '../../components/steps/StepSyncCard';
import { StepTrackingHeader } from '../../components/steps/StepTrackingHeader';
import { Screen } from '../../components/ui/Screen';
import {
  connectHealthConnect,
  disconnectHealthConnect,
  enableStepTracking,
  improveBackgroundCounting,
  openHealthConnectSettings,
  openStepPermissionSettings,
  pauseStepTracking,
  refreshStepStatus,
  resumeStepTracking,
  stopStepTracking,
  syncStepsNow,
} from '../../services/steps';
import {
  useBackgroundRestrictions,
  useBackgroundRisk,
  useHealthConnectStatus,
  useLastStepSyncAt,
  usePendingStepDays,
  usePhoneStepsToday,
  useServerToday,
  useStepSyncError,
  useStepSyncStatus,
  useStepsSupported,
  useTodaySnapshot,
  useTrackingState,
} from '../../stores/stepsStore';
import { useThemedStyles, type ThemeShape } from '../../theme';

const makeStyles = ({ spacing }: ThemeShape) =>
  StyleSheet.create({
    content: { paddingBottom: spacing.xxxl, gap: spacing.md },
  });

/**
 * From Android 14 Health Connect is part of the system, and an app taking
 * its own access away (`revokeSelfPermissionsOnKill`) only lands when the
 * app is next closed — a grant made in between is undone with it. There the
 * switch is in Health Connect's settings, where it takes effect at once.
 */
const DISCONNECT_IN_APP =
  Platform.OS === 'android' && typeof Platform.Version === 'number'
    ? Platform.Version < 34
    : false;

/**
 * Everything about counting steps, in the order a new user meets it: turn
 * counting on, add a watch if there is one, make sure the phone lets it run,
 * see that the steps reached Vokve — and where they came from.
 *
 * Every native call goes through `services/steps`, which owns the tracker,
 * and Health Connect's connection is the one the session keeps — re-read
 * when this screen opens and whenever the user comes back from Health
 * Connect. Not the tracker's own hook: that reads every app's steps out of
 * Health Connect on each of those moments for a list this screen never
 * shows, and Health Connect rate-limits every read. Which apps the steps
 * came from, and how they were matched, is the server's answer, on the step
 * sources page.
 */
export const StepTrackingScreen = () => {
  const styles = useThemedStyles(makeStyles);
  const navigation = useNavigation();
  const toast = useToast();

  const supported = useStepsSupported();
  const trackingState = useTrackingState();
  const phoneSteps = usePhoneStepsToday();
  const snapshot = useTodaySnapshot();
  const background = useBackgroundRestrictions();
  const risk = useBackgroundRisk();
  const syncStatus = useStepSyncStatus();
  const syncError = useStepSyncError();
  const lastSyncedAt = useLastStepSyncAt();
  const pendingDays = usePendingStepDays();
  const serverToday = useServerToday();
  const healthStatus = useHealthConnectStatus();

  const [busy, setBusy] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [isTurnOffOpen, setTurnOffOpen] = useState(false);
  const [isDisconnectOpen, setDisconnectOpen] = useState(false);

  // The user may be back from a settings screen this one sent them to.
  useEffect(() => {
    refreshStepStatus();
  }, []);

  const countingState: CountingState =
    supported === false || trackingState === 'unsupported'
      ? 'unsupported'
      : trackingState === 'running' || trackingState === 'paused'
      ? trackingState
      : 'off';

  const sourceName = snapshot?.stepSource.usedExternal
    ? snapshot.stepSource.appName
    : 'this phone';

  /** Runs one action with the buttons held, and says so if it fails. */
  const run = useCallback(
    async (action: () => Promise<unknown>) => {
      setBusy(true);
      try {
        await action();
      } catch {
        toast.show({
          title: "That didn't work",
          message: 'Please try again in a moment.',
          tone: 'error',
        });
      } finally {
        setBusy(false);
      }
    },
    [toast],
  );

  const onTurnOn = useCallback(async () => {
    setBusy(true);
    const result = await enableStepTracking();
    setBusy(false);
    setPermissionDenied(result === 'permission_denied');
    if (result === 'started') {
      toast.show({
        title: 'Step counting is on',
        message: 'Your steps count from now on, even with the app closed.',
        tone: 'success',
      });
    } else if (result === 'no_sensor') {
      toast.show({
        title: 'No step sensor',
        message: 'This phone has no sensor Vokve can count steps with.',
        tone: 'warning',
      });
    } else if (result === 'failed') {
      toast.show({
        title: "Couldn't start counting",
        message: 'Please try again in a moment.',
        tone: 'error',
      });
    }
  }, [toast]);

  const onPause = useCallback(() => run(pauseStepTracking), [run]);
  const onResume = useCallback(() => run(resumeStepTracking), [run]);
  const onOpenSettings = useCallback(
    () => run(openStepPermissionSettings),
    [run],
  );

  const turnOffActions = useMemo(
    () => [
      {
        label: 'Turn off step counting',
        destructive: true,
        onPress: () => {
          run(stopStepTracking);
        },
      },
    ],
    [run],
  );

  const hcState = healthConnectCardState(healthStatus);
  const onConnectHealth = useCallback(
    () =>
      run(() =>
        hcState === 'settings'
          ? openHealthConnectSettings()
          : connectHealthConnect(),
      ),
    [hcState, run],
  );
  const onManageHealth = useCallback(
    () => run(openHealthConnectSettings),
    [run],
  );
  // Android 13 and below only (see DISCONNECT_IN_APP): there the
  // revocation is immediate, and asked about first.
  const disconnectActions = useMemo(
    () => [
      {
        label: 'Disconnect Health Connect',
        destructive: true,
        onPress: () => {
          run(disconnectHealthConnect);
        },
      },
    ],
    [run],
  );

  const onFixBackground = useCallback(
    () =>
      run(async () => {
        const opened = await improveBackgroundCounting();
        if (opened === 'none') {
          toast.show({
            title: 'Nothing to change',
            message: 'This phone already lets Vokve count in the background.',
            tone: 'success',
          });
        }
      }),
    [run, toast],
  );

  const onSyncNow = useCallback(() => {
    syncStepsNow();
  }, []);

  const onOpenSources = useCallback(
    () => navigation.navigate('StepSources'),
    [navigation],
  );

  const onPressBack = useCallback(() => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate('Main', { screen: 'Home' });
  }, [navigation]);

  const showsSetupOnly =
    countingState === 'off' || countingState === 'unsupported';

  return (
    <Screen edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <StepTrackingHeader onPressBack={onPressBack} />

        <StepCountingCard
          state={countingState}
          steps={phoneSteps}
          sourceName={sourceName}
          permissionDenied={permissionDenied}
          busy={busy}
          onTurnOn={onTurnOn}
          onPause={onPause}
          onResume={onResume}
          onTurnOff={() => setTurnOffOpen(true)}
          onOpenSettings={onOpenSettings}
        />

        {risk ? (
          <BackgroundCountingCard
            risk={risk}
            manufacturer={background?.manufacturer ?? ''}
            onOpenSettings={onFixBackground}
          />
        ) : null}

        {countingState !== 'unsupported' ? (
          <HealthConnectCard
            state={hcState}
            disconnectInApp={DISCONNECT_IN_APP}
            onConnect={onConnectHealth}
            onManage={onManageHealth}
            onDisconnect={() => setDisconnectOpen(true)}
          />
        ) : null}

        {!showsSetupOnly ? (
          <StepSyncCard
            syncing={syncStatus === 'syncing'}
            lastSyncedAt={lastSyncedAt}
            pendingDays={pendingDays}
            serverToday={serverToday}
            error={syncError}
            onSyncNow={onSyncNow}
          />
        ) : null}

        <StepSourcesLinkCard onPress={onOpenSources} />
      </ScrollView>

      <ActionSheet
        visible={isTurnOffOpen}
        onClose={() => setTurnOffOpen(false)}
        title="Turn off step counting?"
        message="Steps you take while it is off are not counted and cannot be added later."
        actions={turnOffActions}
        cancelLabel="Keep counting"
      />

      <ActionSheet
        visible={isDisconnectOpen}
        onClose={() => setDisconnectOpen(false)}
        title="Disconnect Health Connect?"
        message="Vokve stops reading steps from your watch and other apps. Your phone keeps counting."
        actions={disconnectActions}
        cancelLabel="Stay connected"
      />
    </Screen>
  );
};
