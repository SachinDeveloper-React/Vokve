import React, { memo } from 'react';
import {
  Gift,
  HeartPulse,
  Info,
  LifeBuoy,
  LogOut,
  Package,
  Snowflake,
} from 'lucide-react-native';
import { useTheme } from '../../theme';
import { Divider } from '../layout/Divider';
import { VStack } from '../layout/Stack';
import { Card } from '../ui/Card';
import { AccountMenuRow } from './AccountMenuRow';

interface Props {
  /** Shown on the About row — "1.0.0", rendered with the `v` prefix here. */
  appVersion: string;
  onPressOrders: () => void;
  onPressRewards: () => void;
  onPressStreakFreeze: () => void;
  onPressHealthData: () => void;
  onPressHelp: () => void;
  onPressAbout: () => void;
  onPressLogOut: () => void;
}

/**
 * Everything the account screen leads to, as one list.
 *
 * The rows are written out rather than mapped over a config array. Each one
 * has a different icon, tint, destination and — in About's case — a trailing
 * value, so a data-driven version would need a record shape wide enough to
 * describe all of that and would read as less, not more, than the JSX it
 * replaced.
 *
 * Sign-out is the last row rather than a button below the card, which is where
 * this screen used to keep it. As a row it inherits the same tap target and
 * spacing as everything above it, and a destructive button sitting alone under
 * a list is the shape a user hits by accident while scrolling.
 */
export const AccountMenuList = memo(
  ({
    appVersion,
    onPressOrders,
    onPressRewards,
    onPressStreakFreeze,
    onPressHealthData,
    onPressHelp,
    onPressAbout,
    onPressLogOut,
  }: Props) => {
    const { colors } = useTheme();

    return (
      <Card radius="xl" padding="base">
        <VStack>
          <AccountMenuRow
            icon={Package}
            tint={colors.warning}
            title="My Orders"
            subtitle="View your orders and track delivery"
            onPress={onPressOrders}
          />

          <Divider />

          <AccountMenuRow
            icon={Gift}
            tint={colors.avatarIndigo}
            title="My Rewards"
            subtitle="View and track your rewards"
            onPress={onPressRewards}
          />

          <Divider />

          <AccountMenuRow
            icon={Snowflake}
            tint={colors.avatarCyan}
            title="Streak Freeze & Restore"
            subtitle="Manage, freeze or restore your streak"
            onPress={onPressStreakFreeze}
          />

          <Divider />

          <AccountMenuRow
            icon={HeartPulse}
            tint={colors.avatarPink}
            title="Health Data"
            subtitle="Manage your connected health data"
            onPress={onPressHealthData}
          />

          <Divider />

          <AccountMenuRow
            icon={LifeBuoy}
            tint={colors.destructive}
            title="Help & Support"
            subtitle="Get help and find answers"
            onPress={onPressHelp}
          />

          <Divider />

          <AccountMenuRow
            icon={Info}
            tint={colors.mutedForeground}
            title="About VOKVE"
            subtitle="App info, version and more"
            value={`v${appVersion}`}
            onPress={onPressAbout}
          />

          <Divider />

          <AccountMenuRow
            icon={LogOut}
            tint={colors.primary}
            title="Log Out"
            subtitle="Sign out from your account"
            onPress={onPressLogOut}
          />
        </VStack>
      </Card>
    );
  },
);

AccountMenuList.displayName = 'AccountMenuList';
