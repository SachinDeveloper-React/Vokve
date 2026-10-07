import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { StyleSheet, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import {
  ChevronRight,
  CircleDot,
  LocateFixed,
  Package,
  Plus,
  SquareDot,
  Truck,
} from 'lucide-react-native';
import { DeliveryNotice } from '../../components/address/DeliveryNotice';
import { DeliveryToggleRow } from '../../components/address/DeliveryToggleRow';
import { ShippingAddressOption } from '../../components/address/ShippingAddressOption';
import { ShippingSection } from '../../components/address/ShippingSection';
import { SecureRedemptionBanner } from '../../components/cart/SecureRedemptionBanner';
import { TextArea } from '../../components/form/TextArea';
import { HStack, VStack } from '../../components/layout/Stack';
import { Icon } from '../../components/media/Icon';
import { PayAmount } from '../../components/shop/PayAmount';
import { ShopPageHeader } from '../../components/shop/ShopPageHeader';
import { AppText } from '../../components/ui/AppText';
import { Button } from '../../components/ui/Button';
import { Screen } from '../../components/ui/Screen';
import { checkoutApi } from '../../services/api/endpoints';
import { useAuthStatus } from '../../stores/authStore';
import { useAddresses, useAddressesStore } from '../../stores/addressesStore';
import { useCart } from '../../stores/cartStore';
import { useCoinBalance } from '../../stores/coinsStore';
import { useShopConfig } from '../../stores/shopStore';
import {
  spacing,
  useTheme,
  useThemedStyles,
  type ThemeShape,
} from '../../theme';
import type { DeliveryPreferences, Quote } from '../../types/models';
import type { RootStackScreenProps } from '../../types/navigation';

/** The longest note the server keeps for the courier (RULES R17). */
const MAX_INSTRUCTIONS = 120;

const makeStyles = ({ spacing: space, colors }: ThemeShape) =>
  StyleSheet.create({
    content: { paddingBottom: space.xl, gap: space.base },
    grow: { flex: 1 },
    /** Bleeds through the screen's gutter so the rule runs edge to edge. */
    bar: {
      marginHorizontal: -space.base,
      paddingHorizontal: space.base,
      paddingTop: space.md,
      backgroundColor: colors.background,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.base,
    },
  });

/**
 * Where the order goes and how it is handed over (RULES R4, R17): the step
 * between the basket — or a product's "Redeem Now" — and the till.
 *
 * The saved addresses are a radio list that starts on the default; picking
 * another is for this order only, so the default stays the default. A new
 * address added from here comes back chosen. The delivery preferences open
 * as the member last left them (the server keeps them) and are saved again
 * on the way on, then travel with the order, which keeps its own copy.
 * WhatsApp updates are offered only where the server can send them.
 *
 * "You Pay" is the server's figure: the basket's quote, or — for a single
 * line — a quote asked for here, so it matches what the till will show.
 */
export const ShippingAddressScreen = () => {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const route = useRoute<RootStackScreenProps<'ShippingAddress'>['route']>();
  const source = route.params;
  const isSignedIn = useAuthStatus() === 'authenticated';

  const balance = useCoinBalance();
  const config = useShopConfig();
  const cart = useCart();
  const addresses = useAddresses();
  const hydrateAddresses = useAddressesStore(s => s.hydrateFromServer);
  const savedDelivery = useAddressesStore(s => s.delivery);
  const hydrateDelivery = useAddressesStore(s => s.hydrateDelivery);
  const saveDelivery = useAddressesStore(s => s.saveDelivery);

  useEffect(() => {
    if (isSignedIn) {
      hydrateAddresses();
      hydrateDelivery();
    }
  }, [hydrateAddresses, hydrateDelivery, isSignedIn]);

  // ── The address ──────────────────────────────────────────────────────
  const defaultId =
    addresses.find(a => a.isDefault)?.id ?? addresses[0]?.id ?? null;
  const [selectedId, setSelectedId] = useState<string | null>(defaultId);
  /** The ids there were when "Add New Address" was pressed; a new one is chosen on return. */
  const knownIds = useRef<Set<string> | null>(null);

  useEffect(() => {
    setSelectedId(current => {
      const known = knownIds.current;
      const added = known ? addresses.find(a => !known.has(a.id)) : undefined;
      if (added) {
        knownIds.current = null;
        return added.id;
      }
      return current && addresses.some(a => a.id === current)
        ? current
        : defaultId;
    });
  }, [addresses, defaultId]);

  // ── The delivery preferences ─────────────────────────────────────────
  const [instructions, setInstructions] = useState('');
  const [whatsapp, setWhatsapp] = useState(false);
  const [leaveAtDoor, setLeaveAtDoor] = useState(false);
  const touched = useRef(false);

  // The saved preferences fill the form until the member changes it.
  useEffect(() => {
    if (savedDelivery && !touched.current) {
      setInstructions(savedDelivery.instructions);
      setWhatsapp(savedDelivery.whatsappUpdates);
      setLeaveAtDoor(savedDelivery.leaveAtDoor);
    }
  }, [savedDelivery]);

  const onChangeInstructions = useCallback((text: string) => {
    touched.current = true;
    setInstructions(text);
  }, []);
  const onChangeWhatsapp = useCallback((value: boolean) => {
    touched.current = true;
    setWhatsapp(value);
  }, []);
  const onChangeLeaveAtDoor = useCallback((value: boolean) => {
    touched.current = true;
    setLeaveAtDoor(value);
  }, []);

  // ── What it costs ────────────────────────────────────────────────────
  const [linesQuote, setLinesQuote] = useState<Quote | null>(null);
  const lines = 'lines' in source ? source.lines : null;
  useEffect(() => {
    if (!lines) return;
    let cancelled = false;
    checkoutApi
      .quote(lines, 'max')
      .then(result => {
        if (!cancelled) setLinesQuote(result);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [lines]);
  const quote = lines ? linesQuote : cart?.quote ?? null;

  // ── Where it goes ────────────────────────────────────────────────────
  const onPressBack = useCallback(() => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate('Cart');
  }, [navigation]);
  const onPressWallet = useCallback(
    () => navigation.navigate('Main', { screen: 'Wallet' }),
    [navigation],
  );
  const onManage = useCallback(
    () => navigation.navigate('Addresses'),
    [navigation],
  );
  const onEdit = useCallback(
    (id: string) => navigation.navigate('AddressForm', { id }),
    [navigation],
  );
  const onAdd = useCallback(() => {
    knownIds.current = new Set(addresses.map(a => a.id));
    navigation.navigate('AddressForm');
  }, [addresses, navigation]);

  const offersWhatsApp = config?.offersWhatsAppUpdates ?? false;
  const delivery = useMemo<DeliveryPreferences>(
    () => ({
      instructions: instructions.trim(),
      whatsappUpdates: offersWhatsApp && whatsapp,
      leaveAtDoor,
    }),
    [instructions, leaveAtDoor, offersWhatsApp, whatsapp],
  );

  const onContinue = useCallback(() => {
    if (!selectedId) return;
    // Kept for next time; a failure here does not hold the order up — the
    // order carries its own copy either way.
    saveDelivery(delivery).catch(() => {});
    navigation.navigate('Checkout', {
      ...source,
      addressId: selectedId,
      delivery,
    });
  }, [delivery, navigation, saveDelivery, selectedId, source]);

  return (
    <Screen edges={['top']}>
      <ShopPageHeader
        title="Shipping Address"
        subtitle="Where should we deliver your order?"
        balance={balance}
        onPressBack={onPressBack}
        onPressBalance={onPressWallet}
      />

      <KeyboardAwareScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        bottomOffset={24}
      >
        <ShippingSection
          icon={LocateFixed}
          title="Saved Addresses"
          action={
            addresses.length > 0
              ? { label: 'Manage', onPress: onManage }
              : undefined
          }
        >
          {addresses.length === 0 ? (
            <AppText variant="caption" color="textSecondary">
              No saved addresses yet. Add where this order should go.
            </AppText>
          ) : (
            addresses.map(address => (
              <ShippingAddressOption
                key={address.id}
                address={address}
                selected={address.id === selectedId}
                onSelect={setSelectedId}
                onEdit={onEdit}
              />
            ))
          )}
          <Button
            label="Add New Address"
            variant="brandOutline"
            size="sm"
            fullWidth
            onPress={onAdd}
            icon={<Icon as={Plus} size="sm" tint={colors.brandAccent} />}
          />
        </ShippingSection>

        <ShippingSection icon={Truck} title="Delivery Preferences">
          <TextArea
            label="Delivery Instructions (Optional)"
            value={instructions}
            onChangeText={onChangeInstructions}
            placeholder="E.g. Leave at the gate, Call before delivery, etc."
            maxLength={MAX_INSTRUCTIONS}
            rows={2}
            showCount
            accessibilityLabel="Delivery instructions"
          />
          {offersWhatsApp ? (
            <DeliveryToggleRow
              icon={CircleDot}
              title="Notify me on WhatsApp"
              caption="Get delivery updates on WhatsApp"
              value={whatsapp}
              onChange={onChangeWhatsapp}
            />
          ) : null}
          <DeliveryToggleRow
            icon={SquareDot}
            title="Leave at door"
            caption="Allow delivery partner to leave at door"
            value={leaveAtDoor}
            onChange={onChangeLeaveAtDoor}
          />
        </ShippingSection>

        {config?.deliveryNotice ? (
          <DeliveryNotice text={config.deliveryNotice} />
        ) : null}

        <SecureRedemptionBanner
          title="100% Secure Delivery"
          caption="Your order is safe with us"
          trailing={Package}
        />
      </KeyboardAwareScrollView>

      <View
        style={[
          styles.bar,
          { paddingBottom: Math.max(insets.bottom, spacing.base) },
        ]}
      >
        <VStack flex={1} gap="xxs">
          <AppText variant="bodyStrong">You Pay</AppText>
          {quote ? <PayAmount quote={quote} size="lg" /> : null}
        </VStack>
        <HStack style={styles.grow}>
          <Button
            label="Continue to Checkout"
            variant="brand"
            fullWidth
            disabled={!selectedId}
            onPress={onContinue}
            iconPosition="trailing"
            icon={
              <Icon
                as={ChevronRight}
                size="sm"
                tint={colors.primaryForeground}
              />
            }
          />
        </HStack>
      </View>
    </Screen>
  );
};
