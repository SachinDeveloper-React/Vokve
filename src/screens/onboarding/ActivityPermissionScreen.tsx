import React, { useCallback, useState } from 'react';
import {
  BatteryCharging,
  Flame,
  Footprints,
  MapPinOff,
} from 'lucide-react-native';
import { PermissionStepLayout } from '../../components';
import { useToast } from '../../components/feedback/Toast';
import { usePermissionStep } from '../../navigation/permissionsFlow';
import { enableStepCounting } from '../../services/steps';
import { useTheme } from '../../theme';

/**
 * Physical activity — Android's name for step counting — and counting on.
 * The system dialog says only "Allow Vokve to access your physical
 * activity?", so this says what that means first: the phone's own sensor,
 * all day, nothing about where the user is.
 */
export const ActivityPermissionScreen = () => {
  const { colors } = useTheme();
  const toast = useToast();
  const { position, total, next } = usePermissionStep('activity');
  const [busy, setBusy] = useState(false);

  const onAllow = useCallback(async () => {
    setBusy(true);
    const result = await enableStepCounting();
    setBusy(false);
    if (result === 'permission_denied') {
      toast.show({
        title: 'Step counting is off',
        message: 'You can turn it on anytime from Step tracking.',
        tone: 'info',
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
        message: 'You can try again from Step tracking.',
        tone: 'error',
      });
    }
    next();
  }, [next, toast]);

  return (
    <PermissionStepLayout
      step={position}
      total={total}
      icon={Footprints}
      tint={colors.brandAccent}
      title="Count your steps"
      message="Vokve counts your steps with your phone's own motion sensor — all day, even when the app is closed."
      points={[
        {
          icon: Flame,
          text: 'Your steps build your daily goal, streak and rewards',
        },
        {
          icon: BatteryCharging,
          text: "Light on battery: it uses the phone's built-in step counter",
        },
        {
          icon: MapPinOff,
          text: 'Only your steps are counted — never your location',
        },
      ]}
      allowLabel="Allow physical activity"
      onAllow={onAllow}
      busy={busy}
      onSkip={next}
      footnote={'Android will ask to allow "Physical activity".'}
    />
  );
};
