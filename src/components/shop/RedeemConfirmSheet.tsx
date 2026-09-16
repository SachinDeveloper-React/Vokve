import React, { memo, useCallback } from 'react';
import { StyleSheet } from 'react-native';
import { MapPin, ShieldCheck } from 'lucide-react-native';
import { useTheme } from '../../theme';
import { moderateScale } from '../../theme/responsive';
import type { Address, ShopItem } from '../../types/models';
import { withAlpha } from '../../utils/color';
import { formatCoins } from '../../utils/format';
import { formatAddressLines } from '../address/AddressCard';
import { BottomSheet } from '../disclosure/BottomSheet';
import { Box } from '../layout/Box';
import { Divider } from '../layout/Divider';
import { HStack, VStack } from '../layout/Stack';
import { Emoji } from '../media/Emoji';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Button } from '../ui/Button';
import { CoinAmount } from '../wallet/CoinAmount';
import { Pressable } from '../form/Pressable';

interface Props {
  /** The reward being redeemed, or null to close the sheet. */
  item: ShopItem | null;
  balance: number;
  /** Where it ships — the default address — or null with none on file. */
  address: Address | null;
  /** The price at and above which the server will ask for a code first. */
  stepUpThreshold: number;
  isRedeeming: boolean;
  onConfirm: (item: ShopItem, address: Address) => void;
  /** Opens the address book — to pick another, or to add the first. */
  onPressAddress: () => void;
  onClose: () => void;
}

/**
 * The last look before coins are spent (RULES R2–R4).
 *
 * The detail sheet says what the reward is; this says what will happen: the
 * exact coins, the exact door, and — above the threshold — that a code will
 * be asked for next. Nothing here can be tapped by accident into an order:
 * the button that spends is the only brand-coloured thing on it, and it is
 * disabled until there is somewhere to send the reward.
 */
export const RedeemConfirmSheet = memo(
  ({
    item,
    balance,
    address,
    stepUpThreshold,
    isRedeeming,
    onConfirm,
    onPressAddress,
    onClose,
  }: Props) => {
    const { colors, isDark } = useTheme();

    const confirm = useCallback(() => {
      if (item && address) {
        onConfirm(item, address);
      }
    }, [address, item, onConfirm]);

    if (!item) {
      return null;
    }

    const shortfall = item.priceCoins - balance;
    const canPay = shortfall <= 0;
    const needsStepUp = item.priceCoins >= stepUpThreshold;
    const remaining = balance - item.priceCoins;

    return (
      <BottomSheet
        visible
        onClose={onClose}
        title="Confirm redemption"
        dismissible={!isRedeeming}
      >
        <VStack gap="base" pb="base">
          <HStack align="center" gap="md">
            <Box bg="muted" radius="lg" style={styles.art}>
              <Emoji size={moderateScale(30)} label={item.title}>
                {item.emoji}
              </Emoji>
            </Box>
            <VStack flex={1} gap="xxs">
              <AppText variant="bodyStrong" numberOfLines={2}>
                {item.title}
              </AppText>
              <CoinAmount amount={item.priceCoins} size="md" />
            </VStack>
          </HStack>

          <Divider />

          <Pressable
            onPress={onPressAddress}
            feedback="opacity"
            disabled={isRedeeming}
            accessibilityRole="button"
            accessibilityLabel={
              address
                ? `Deliver to ${address.label}. Change address`
                : 'Add a shipping address'
            }
          >
            <HStack align="start" gap="md">
              <Icon
                as={MapPin}
                size="lg"
                tint={address ? colors.primary : colors.warning}
              />
              <VStack flex={1} gap="xxs">
                {address ? (
                  <>
                    <HStack align="center" justify="between" gap="sm">
                      <AppText variant="label" color="textSecondary">
                        {`Deliver to · ${address.label}`}
                      </AppText>
                      <AppText variant="micro" color="primary">
                        Change
                      </AppText>
                    </HStack>
                    <AppText variant="body">{address.name}</AppText>
                    {formatAddressLines(address).map(line => (
                      <AppText
                        key={line}
                        variant="caption"
                        color="textSecondary"
                      >
                        {line}
                      </AppText>
                    ))}
                  </>
                ) : (
                  <>
                    <AppText variant="bodyStrong">
                      Add a shipping address
                    </AppText>
                    <AppText variant="caption" color="textSecondary">
                      Rewards are posted to you, so we need somewhere to send
                      it.
                    </AppText>
                  </>
                )}
              </VStack>
            </HStack>
          </Pressable>

          <Divider />

          <VStack gap="xs">
            <HStack align="center" justify="between">
              <AppText variant="caption" color="textSecondary">
                Your coins
              </AppText>
              <AppText variant="caption">{formatCoins(balance)}</AppText>
            </HStack>
            <HStack align="center" justify="between">
              <AppText variant="caption" color="textSecondary">
                This reward
              </AppText>
              <AppText variant="caption">{`− ${formatCoins(
                item.priceCoins,
              )}`}</AppText>
            </HStack>
            <HStack align="center" justify="between">
              <AppText variant="bodyStrong">
                {canPay ? 'Coins after' : 'Still needed'}
              </AppText>
              <AppText
                variant="bodyStrong"
                style={{ color: canPay ? colors.text : colors.destructive }}
              >
                {formatCoins(canPay ? remaining : shortfall)}
              </AppText>
            </HStack>
          </VStack>

          {needsStepUp && canPay ? (
            <Box
              radius="lg"
              p="md"
              style={{
                backgroundColor: withAlpha(
                  colors.primary,
                  isDark ? 0.14 : 0.08,
                ),
              }}
            >
              <HStack align="center" gap="sm">
                <Icon as={ShieldCheck} size="md" tint={colors.primary} />
                <AppText
                  variant="caption"
                  color="textSecondary"
                  style={styles.grow}
                >
                  {`Rewards of ${formatCoins(
                    stepUpThreshold,
                  )} coins or more need a quick code from your email first.`}
                </AppText>
              </HStack>
            </Box>
          ) : null}

          <VStack gap="sm" pt="xs">
            <Button
              label={
                !address
                  ? 'Add an address first'
                  : !canPay
                  ? `Need ${formatCoins(shortfall)} more`
                  : needsStepUp
                  ? 'Confirm & get code'
                  : 'Confirm & redeem'
              }
              variant="brand"
              fullWidth
              loading={isRedeeming}
              disabled={isRedeeming || !address || !canPay || !item.inStock}
              onPress={confirm}
            />
            <Button
              label="Not now"
              variant="ghost"
              fullWidth
              disabled={isRedeeming}
              onPress={onClose}
            />
          </VStack>
        </VStack>
      </BottomSheet>
    );
  },
);

RedeemConfirmSheet.displayName = 'RedeemConfirmSheet';

const styles = StyleSheet.create({
  art: {
    width: moderateScale(56),
    height: moderateScale(56),
    alignItems: 'center',
    justifyContent: 'center',
  },
  grow: { flex: 1 },
});
