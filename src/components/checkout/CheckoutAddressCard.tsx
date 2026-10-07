import React, { memo } from 'react';
import { StyleSheet } from 'react-native';
import { MapPin } from 'lucide-react-native';
import { useTheme } from '../../theme';
import type { Address, DeliveryPreferences } from '../../types/models';
import { HStack, VStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Tag } from '../ui/Tag';
import { formatAddressLines } from '../address/AddressCard';
import { deliverySummary } from '../address/deliverySummary';
import { CheckoutCard } from './CheckoutCard';

interface Props {
  /** Null before one is saved: the panel then asks for one. */
  address: Address | null;
  /** What the shipping page asked the courier for, read back in one line. */
  delivery?: Partial<DeliveryPreferences> | null;
  onPressChange: () => void;
}

/**
 * Where the order goes, read back before it is paid for: the label with its
 * Default flag, the name, the three lines a courier reads, and whatever the
 * shipping page asked of the delivery. Changing it is the shipping page's
 * job, so the link leads back there rather than editing in place.
 */
export const CheckoutAddressCard = memo(
  ({ address, delivery, onPressChange }: Props) => {
    const { colors } = useTheme();
    const summary = deliverySummary(delivery);

    return (
      <CheckoutCard
        title="Delivery Address"
        action={{
          label: address ? 'Change' : 'Add',
          onPress: onPressChange,
          accessibilityLabel: address
            ? 'Change delivery address'
            : 'Add a delivery address',
        }}
      >
        <HStack align="start" gap="md">
          <Icon as={MapPin} size="md" tint={colors.brandAccent} />
          {address ? (
            <VStack flex={1} gap="xxs">
              <HStack align="center" gap="sm" wrap>
                <AppText variant="bodyStrong">{address.label}</AppText>
                {address.isDefault ? (
                  <Tag label="Default" tint={colors.brandAccent} />
                ) : null}
              </HStack>
              <AppText variant="body">{address.name}</AppText>
              {formatAddressLines(address).map(line => (
                <AppText key={line} variant="caption" color="textSecondary">
                  {line}
                </AppText>
              ))}
              {summary ? (
                <AppText variant="micro" color="textTertiary">
                  {summary}
                </AppText>
              ) : null}
            </VStack>
          ) : (
            <AppText variant="caption" color="textSecondary" style={styles.fill}>
              Tell us where this order should be sent.
            </AppText>
          )}
        </HStack>
      </CheckoutCard>
    );
  },
);

CheckoutAddressCard.displayName = 'CheckoutAddressCard';

const styles = StyleSheet.create({ fill: { flex: 1 } });
