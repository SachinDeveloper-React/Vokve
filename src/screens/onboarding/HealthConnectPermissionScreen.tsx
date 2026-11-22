import React, { useCallback, useState } from 'react';
import {
  ArrowLeftRight,
  HeartPulse,
  Info,
  ShieldCheck,
  ToggleRight,
  Watch,
} from 'lucide-react-native';
import { PermissionStepLayout } from '../../components';
import { healthConnectCardState } from '../../components/steps/HealthConnectCard';
import { useToast } from '../../components/feedback/Toast';
import { usePermissionStep } from '../../navigation/permissionsFlow';
import { recordPermissionAnswer } from '../../services/permissions';
import { connectHealthConnect } from '../../services/steps';
import {
  useHealthConnectStatus,
  useHealthConnectWrites,
} from '../../stores/stepsStore';
import { useTheme } from '../../theme';
import { isAppleHealth } from '../../utils/healthStore';

/** The button for each rung of Health Connect's ladder. */
const ALLOW_LABEL = {
  install: 'Install Health Connect',
  update: 'Update Health Connect',
  settings: 'Open Health Connect',
} as const;

/** Apple Health's points: read only, always (the iPhone writes its own steps). */
const APPLE_POINTS = [
  { icon: Watch, text: 'Works with Apple Watch and apps that share steps with Apple Health' },
  {
    icon: ShieldCheck,
    text: 'Vokve only reads steps and distance — it never writes or changes your data',
  },
  { icon: ToggleRight, text: 'Optional — turn it off anytime in the Health app' },
];

/**
 * Health Connect — how a watch's steps reach Vokve, and how the steps this
 * phone counts reach the user's other fitness apps (D-57). Optional and
 * said so: the phone counts on its own. The button walks Health Connect's
 * ladder (install, update, ask, or its settings once the sheet has stopped
 * appearing); a grant moves on, anything else stays here with the next rung
 * on the button, and "Skip" always moves on.
 */
export const HealthConnectPermissionScreen = () => {
  const { colors } = useTheme();
  const toast = useToast();
  const { position, total, next } = usePermissionStep('healthConnect');
  const status = useHealthConnectStatus();
  const writes = useHealthConnectWrites();
  const [busy, setBusy] = useState(false);

  const rung = healthConnectCardState(status);
  // On an iPhone the same screen asks for Apple Health, which Vokve only reads.
  const apple = isAppleHealth(status);
  const allowLabel = apple
    ? rung === 'settings'
      ? 'Open Apple Health'
      : 'Connect Apple Health'
    : rung === 'install' || rung === 'update' || rung === 'settings'
      ? ALLOW_LABEL[rung]
      : 'Connect Health Connect';

  const onAllow = useCallback(async () => {
    setBusy(true);
    try {
      const after = await connectHealthConnect();
      const allowed = after.stepsGranted ?? after.canReadSteps ?? after.canRead;
      recordPermissionAnswer(
        'healthConnect',
        allowed ? 'granted' : 'denied',
      );
      if (allowed) {
        next();
      }
    } catch {
      recordPermissionAnswer('healthConnect', 'failed');
      toast.show({
        title: apple ? "Couldn't open Apple Health" : "Couldn't open Health Connect",
        message: 'You can connect it later from Step tracking.',
        tone: 'error',
      });
    } finally {
      setBusy(false);
    }
  }, [apple, next, toast]);

  const onSkip = useCallback(() => {
    recordPermissionAnswer('healthConnect', 'skipped');
    next();
  }, [next]);

  return (
    <PermissionStepLayout
      step={position}
      total={total}
      icon={HeartPulse}
      tint={colors.avatarPink}
      title="Connect your watch"
      message={
        apple
          ? 'Wear an Apple Watch? Apple Health lets Vokve read its steps, so a walk your iPhone missed still counts.'
          : 'Wear a watch or band? Health Connect lets Vokve read its steps, so a walk your phone missed still counts.'
      }
      points={apple ? APPLE_POINTS : [
        {
          icon: Watch,
          text: 'Works with watch apps like Google Fit and Fitbit',
        },
        ...(writes
          ? [
              {
                icon: ArrowLeftRight,
                text: 'Adds the steps your phone counts, so your other fitness apps see them',
              },
              {
                icon: ShieldCheck,
                text: "Vokve writes only your steps — it never changes other apps' data",
              },
            ]
          : [
              {
                icon: ShieldCheck,
                text: 'Vokve only reads steps and distance — it never writes or changes your data',
              },
            ]),
        {
          icon: ToggleRight,
          text: 'Optional — turn it off anytime in Health Connect',
        },
      ]}
      note={
        apple
          ? {
              icon: Info,
              title: 'Another watch?',
              message:
                "Turn on its app's sharing with Apple Health, so your watch's steps reach it.",
            }
          : {
              icon: Info,
              title: 'Using Google Fit?',
              message:
                "In Google Fit's settings, turn on syncing with Health Connect so your watch's steps reach it.",
            }
      }
      allowLabel={allowLabel}
      onAllow={onAllow}
      busy={busy}
      skipLabel="Skip"
      onSkip={onSkip}
    />
  );
};
