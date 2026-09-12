import React, { memo } from 'react';
import { ArrowDownToLine, History, Package, ShoppingBag } from 'lucide-react-native';
import { useTheme } from '../../theme';
import { Divider } from '../layout/Divider';
import { HStack } from '../layout/Stack';
import { Card } from '../ui/Card';
import { WalletActionItem } from './WalletActionItem';

interface Props {
  onPressEarn: () => void;
  onPressShop: () => void;
  onPressHistory: () => void;
  onPressOrders: () => void;
}

/**
 * The four places a coin balance leads: earn more, spend it, audit it, track
 * what was bought with it.
 *
 * Four across the width rather than a scrolling row like the dashboard's:
 * these are the wallet's whole navigation, and a fifth shortcut hidden off the
 * right edge would be a destination the user never learns exists.
 */
export const WalletActionsRow = memo(
  ({ onPressEarn, onPressShop, onPressHistory, onPressOrders }: Props) => {
    const { colors } = useTheme();

    return (
      <Card radius="lg" padding="md">
        {/* `align="stretch"` so the rules between the items take the row's height. */}
        <HStack align="stretch">
          <WalletActionItem
            icon={ArrowDownToLine}
            tint={colors.success}
            title="Earn Coins"
            caption="More ways to earn"
            onPress={onPressEarn}
          />

          <Divider orientation="vertical" />

          <WalletActionItem
            icon={ShoppingBag}
            tint={colors.avatarPurple}
            title="Shop"
            caption="Spend your coins"
            onPress={onPressShop}
          />

          <Divider orientation="vertical" />

          <WalletActionItem
            icon={History}
            tint={colors.primary}
            title="Coin History"
            caption="All transactions"
            onPress={onPressHistory}
          />

          <Divider orientation="vertical" />

          <WalletActionItem
            icon={Package}
            tint={colors.brandAccent}
            title="My Orders"
            caption="Track your orders"
            onPress={onPressOrders}
          />
        </HStack>
      </Card>
    );
  },
);

WalletActionsRow.displayName = 'WalletActionsRow';
