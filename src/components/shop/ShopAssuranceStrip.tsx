import React, { memo } from 'react';
import { BadgeCheck, RotateCcw, ShieldCheck, Truck } from 'lucide-react-native';
import { useTheme } from '../../theme';
import { Grid } from '../layout/Grid';
import { Card } from '../ui/Card';
import { ShopAssuranceItem } from './ShopAssuranceItem';

/**
 * The four promises at the foot of the shop.
 *
 * Static on purpose: nothing here is a link, because a guarantee that leads
 * somewhere reads as a guarantee with conditions. Two columns on a phone,
 * four on anything wider — four across a 375pt card leaves each promise 50pt
 * for its text beside the glyph, which is not enough for "Secure Payments".
 */
export const ShopAssuranceStrip = memo(() => {
  const { colors } = useTheme();

  return (
    <Card radius="xl" padding="base">
      <Grid columns={{ compact: 2, medium: 4 }} gap="base">
        <ShopAssuranceItem
          icon={BadgeCheck}
          tint={colors.textSecondary}
          title="100% Genuine"
          caption="Quality assured products"
        />
        <ShopAssuranceItem
          icon={Truck}
          tint={colors.success}
          title="Fast Delivery"
          caption="Quick and reliable shipping"
        />
        <ShopAssuranceItem
          icon={RotateCcw}
          tint={colors.avatarGreen}
          title="Easy Returns"
          caption="Hassle-free returns"
        />
        <ShopAssuranceItem
          icon={ShieldCheck}
          tint={colors.textSecondary}
          title="Secure Payments"
          caption="Safe and secure transactions"
        />
      </Grid>
    </Card>
  );
});

ShopAssuranceStrip.displayName = 'ShopAssuranceStrip';
