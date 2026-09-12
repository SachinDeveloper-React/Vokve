import React, { memo } from 'react';
import {
  Bell,
  Lock,
  Palette,
  ShieldCheck,
  UserPen,
} from 'lucide-react-native';
import { useTheme } from '../../theme';
import { HStack } from '../layout/Stack';
import { Card } from '../ui/Card';
import { AccountShortcut } from './AccountShortcut';

interface Props {
  onPressEditProfile: () => void;
  onPressPrivacy: () => void;
  onPressNotifications: () => void;
  onPressAppearance: () => void;
  onPressSecurity: () => void;
}

/**
 * The five settings shortcuts under the profile panel.
 *
 * Fixed across the width rather than scrolling like the home screen's action
 * row. That row's cards carry two lines of copy each and genuinely do not fit;
 * these are a disc and a word, and a settings row that hid its fifth item
 * offscreen would be the one place in the app where a user cannot see
 * everything they are allowed to change.
 */
export const AccountShortcutsRow = memo(
  ({
    onPressEditProfile,
    onPressPrivacy,
    onPressNotifications,
    onPressAppearance,
    onPressSecurity,
  }: Props) => {
    const { colors } = useTheme();

    return (
      <Card radius="xl" padding="base">
        <HStack align="start">
          <AccountShortcut
            icon={UserPen}
            tint={colors.warning}
            label="Edit Profile"
            onPress={onPressEditProfile}
          />
          <AccountShortcut
            icon={ShieldCheck}
            tint={colors.success}
            label="Privacy"
            onPress={onPressPrivacy}
          />
          <AccountShortcut
            icon={Bell}
            tint={colors.avatarPurple}
            label="Notification Settings"
            onPress={onPressNotifications}
          />
          <AccountShortcut
            icon={Palette}
            tint={colors.primary}
            label="Appearance"
            onPress={onPressAppearance}
          />
          <AccountShortcut
            icon={Lock}
            tint={colors.destructive}
            label="Security"
            onPress={onPressSecurity}
          />
        </HStack>
      </Card>
    );
  },
);

AccountShortcutsRow.displayName = 'AccountShortcutsRow';
