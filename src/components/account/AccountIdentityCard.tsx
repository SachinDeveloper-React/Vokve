import React, { memo } from 'react';
import { ChevronRight } from 'lucide-react-native';
import { useTheme } from '../../theme';
import { withAlpha } from '../../utils/color';
import { Box } from '../layout/Box';
import { HStack, VStack } from '../layout/Stack';
import { Pressable } from '../form/Pressable';
import { Avatar } from '../media/Avatar';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Card } from '../ui/Card';
import { CoinAmount } from '../wallet/CoinAmount';

interface Props {
  /** Null while the profile is loading. */
  name?: string | null;
  email?: string | null;
  avatarUri?: string | null;
  balance: number;
  onPressWallet: () => void;
}

/**
 * Who is signed in, and what they hold.
 *
 * The coin balance is a shortcut to the wallet rather than a static figure:
 * the account screen is where a user lands when they go looking for their
 * money, and a number here that could not be tapped would be a dead end.
 */
export const AccountIdentityCard = memo(
  ({ name, email, avatarUri, balance, onPressWallet }: Props) => {
    const { colors, isDark } = useTheme();

    return (
      <Card radius="xl" padding="lg">
        <VStack gap="base">
          <HStack align="center" gap="base">
            <Avatar name={name ?? 'vokve'} uri={avatarUri} size="lg" ring />

            <VStack flex={1} gap="xxs">
              <AppText variant="h2" numberOfLines={1}>
                {name ?? 'Your account'}
              </AppText>
              {email ? (
                <AppText
                  variant="caption"
                  color="textSecondary"
                  numberOfLines={1}
                >
                  {email}
                </AppText>
              ) : null}
            </VStack>
          </HStack>

          <Pressable
            onPress={onPressWallet}
            feedback="highlight"
            accessibilityRole="button"
            accessibilityLabel={`Coin balance ${balance}, open wallet`}
          >
            <Box
              px="base"
              py="md"
              radius="lg"
              style={{
                backgroundColor: withAlpha(colors.gold, isDark ? 0.18 : 0.1),
              }}
            >
              <HStack align="center" justify="between">
                <CoinAmount amount={balance} size="lg" />
                <Icon as={ChevronRight} size="sm" tint={colors.gold} />
              </HStack>
            </Box>
          </Pressable>
        </VStack>
      </Card>
    );
  },
);

AccountIdentityCard.displayName = 'AccountIdentityCard';
